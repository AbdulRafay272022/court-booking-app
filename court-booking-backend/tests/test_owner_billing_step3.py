"""Owner premium billing, step 3: an owner pays an invoice by screenshot, an admin approves / rejects / records / reverses."""

import asyncio
import io
from datetime import date, datetime, timezone

import pytest
from PIL import Image
from sqlalchemy import select

from app.config import get_settings
from app.models.audit import AuditLog
from app.models.notification import NotificationLog
from app.models.owner_billing import OwnerFeature, OwnerInvoice, OwnerPayment, PremiumFeature
from app.models.user import UserRole
from app.services.ai.base import PaymentExtraction
from app.services.entitlement_service import SELLABLE_KEYS, EntitlementService
from app.services.owner_billing_service import OwnerBillingService
from app.services.payment_service import PaymentService

E = datetime(2026, 10, 10, 9, 0, tzinfo=timezone.utc)  # enabled 10 Oct -> trial to 24 Oct -> first charge 25 Oct (prorated 7/31)
KEY = "auto_approve"


def png(color=(200, 30, 30)) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", (64, 64), color)
    for x in range(0, 64, 4):  # some structure so different colours hash differently
        for y in range(0, 64, 4):
            img.putpixel((x, y), (x * 4 % 256, y * 4 % 256, color[2]))
    img.save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def fake_storage(monkeypatch):
    async def fake_upload(data, filename, content_type):
        return f"payment-proofs/test-{abs(hash(data)) % 10**8}.png"

    monkeypatch.setattr("app.services.owner_payment_service.upload_private_proof", fake_upload)
    monkeypatch.setattr("app.api.admin_billing.signed_private_url", lambda key, expires_in=900: f"https://signed.example/{key}")


def read_amount(monkeypatch, amount, ref="TXN1"):
    async def fake(self, proof_bytes, content_type, expected):
        return PaymentExtraction(amount=amount, reference=ref, timestamp=None, confidence=0.9, raw_response={})

    monkeypatch.setattr(PaymentService, "_extract_payment_proof", fake)


@pytest.fixture
def world(db_session_factory, make_user, make_auth_headers):
    """One priced feature, billing enforced, an owner and an admin, and a helper that issues the owner's first invoice."""

    class World:
        async def setup(self, phone_owner="+923097000001", phone_admin="+923097000002"):
            async with db_session_factory() as session:
                from app.models.feature_flag import FeatureFlag

                for key in SELLABLE_KEYS:
                    session.add(PremiumFeature(key=key, label=key, monthly_price_pkr=3100 if key == KEY else 0, is_sellable=key == KEY))
                session.add(FeatureFlag(key="owner_billing_enforced", enabled=True, label="x"))
                await session.commit()
            self.owner = await make_user(phone_owner, role=UserRole.OWNER)
            self.admin = await make_user(phone_admin, role=UserRole.ADMIN)
            async with db_session_factory() as session:
                session.add(OwnerFeature(owner_id=self.owner.id, feature_key=KEY, price_pkr=3100, enabled_at=E))
                await session.commit()
            self.owner_h = await make_auth_headers(self.owner)
            self.admin_h = await make_auth_headers(self.admin)
            return self

        async def invoice(self, today=date(2026, 10, 20)):
            async with db_session_factory() as session:
                inv = await OwnerBillingService(session, get_settings()).generate_for_owner(self.owner.id, today=today)
                return inv.id

    return World()


async def _upload(client, headers, invoice_id, data=None, content_type="image/png"):
    return await client.post(
        f"/api/v1/owners/premium/invoices/{invoice_id}/payment-proof", headers=headers,
        files={"image": ("proof.png", data or png(), content_type)},
    )


async def _row(db_session_factory, model, **where):
    async with db_session_factory() as session:
        return (await session.execute(select(model).filter_by(**where))).scalars().all()


# --- owner: upload ----------------------------------------------------------------------------------------------------------


async def test_owner_uploads_a_screenshot_and_the_invoice_waits_for_the_admin(client, world, db_session_factory, monkeypatch):
    await world.setup()
    read_amount(monkeypatch, 700.0)
    invoice_id = await world.invoice()
    resp = await _upload(client, world.owner_h, invoice_id)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert [i["status"] for i in body["invoices"]] == ["proof_submitted"]
    (payment,) = await _row(db_session_factory, OwnerPayment)
    assert (payment.status, payment.amount_pkr, payment.method, payment.reference) == ("submitted", 700, "bank_transfer_proof", "TXN1")
    assert "matches the invoice" in payment.note and payment.proof_key.startswith("payment-proofs/")


async def test_the_admin_is_told_what_the_screenshot_showed(client, world, db_session_factory, monkeypatch):
    await world.setup()
    invoice_id = await world.invoice()
    for n, (amount, words) in enumerate(((500.0, "200 less"), (None, "could not be read"), (900.0, "200 more"))):
        read_amount(monkeypatch, amount)
        async with db_session_factory() as session:  # start each round from a clean, waiting invoice
            await session.execute(__import__("sqlalchemy").delete(OwnerPayment))
            await session.execute(__import__("sqlalchemy").update(OwnerInvoice).values(status="issued"))
            await session.commit()
        assert (await _upload(client, world.owner_h, invoice_id, png((20 + n * 40, 10, 10)))).status_code == 201
        (payment,) = await _row(db_session_factory, OwnerPayment)
        assert words in payment.note, payment.note


async def test_only_the_invoice_owner_can_pay_it_and_only_while_it_waits(client, world, db_session_factory, make_user, make_auth_headers, monkeypatch):
    await world.setup()
    read_amount(monkeypatch, 700.0)
    invoice_id = await world.invoice()
    other = await make_user("+923097000003", role=UserRole.OWNER)
    assert (await _upload(client, await make_auth_headers(other), invoice_id)).status_code == 404  # not theirs: it does not exist for them
    assert (await _upload(client, world.owner_h, invoice_id)).status_code == 201
    again = await _upload(client, world.owner_h, invoice_id, png((9, 9, 9)))
    assert again.status_code == 409 and again.json()["error"]["code"] == "INVOICE_NOT_PAYABLE"  # already being checked
    assert len(await _row(db_session_factory, OwnerPayment)) == 1


async def test_bad_files_are_refused(client, world):
    await world.setup()
    invoice_id = await world.invoice()
    assert (await _upload(client, world.owner_h, invoice_id, b"not an image", "image/png")).status_code == 400
    assert (await _upload(client, world.owner_h, invoice_id, png(), "application/pdf")).status_code == 400


async def test_a_screenshot_already_used_for_another_invoice_is_flagged(client, world, db_session_factory, monkeypatch):
    await world.setup()
    read_amount(monkeypatch, 700.0)
    first = await world.invoice()
    same = png()
    assert (await _upload(client, world.owner_h, first, same)).status_code == 201
    # a second, later invoice (December) paid with the very same picture
    async with db_session_factory() as session:
        row = (await session.execute(select(OwnerFeature))).scalar_one()
        row.paid_through = date(2026, 10, 31)
        await session.commit()
        second = (await OwnerBillingService(session, get_settings()).generate_for_owner(world.owner.id, today=date(2026, 10, 25))).id
    assert (await _upload(client, world.owner_h, second, same)).status_code == 201
    payments = await _row(db_session_factory, OwnerPayment, invoice_id=second)
    assert "looks the same as one already used" in payments[0].note


async def test_the_owner_sees_the_payment_details_only_when_they_are_configured(client, world, monkeypatch):
    await world.setup()
    assert (await client.get("/api/v1/owners/premium", headers=world.owner_h)).json()["payment_instructions"] is None
    settings = get_settings()
    monkeypatch.setattr(settings, "PLATFORM_ACCOUNT_NUMBER", "00021515610055")
    monkeypatch.setattr(settings, "PLATFORM_ACCOUNT_TITLE", "Maidan")
    monkeypatch.setattr(settings, "PLATFORM_BANK_NAME", "HBL")
    details = (await client.get("/api/v1/owners/premium", headers=world.owner_h)).json()["payment_instructions"]
    assert details["account_number"] == "00021515610055" and details["bank"] == "HBL" and details["iban"] == ""


# --- admin: approve / reject ------------------------------------------------------------------------------------------------


async def _submitted(client, world, monkeypatch, db_session_factory):
    read_amount(monkeypatch, 700.0)
    invoice_id = await world.invoice()
    assert (await _upload(client, world.owner_h, invoice_id)).status_code == 201
    (payment,) = await _row(db_session_factory, OwnerPayment, invoice_id=invoice_id)
    return invoice_id, payment.id


async def test_only_an_admin_sees_or_decides_owner_payments(client, world, monkeypatch, db_session_factory):
    await world.setup()
    _inv, payment_id = await _submitted(client, world, monkeypatch, db_session_factory)
    for method, url, body in (
        ("get", "/api/v1/admin/owner-payments", None),
        ("post", f"/api/v1/admin/owner-payments/{payment_id}/approve", None),
        ("post", f"/api/v1/admin/owner-payments/{payment_id}/reject", {"reason": "x"}),
        ("get", "/api/v1/admin/owner-invoices", None),
    ):
        resp = await getattr(client, method)(url, headers=world.owner_h, **({"json": body} if body else {}))
        assert resp.status_code == 403, url


async def test_the_admin_queue_shows_the_screenshot_the_note_and_the_lines(client, world, monkeypatch, db_session_factory):
    await world.setup()
    await _submitted(client, world, monkeypatch, db_session_factory)
    (item,) = (await client.get("/api/v1/admin/owner-payments", headers=world.admin_h)).json()
    assert item["amount_pkr"] == 700 and item["owner_phone"] == "+923097000001" and item["proof_url"].startswith("https://signed.example/")
    assert item["lines"][0]["feature_key"] == KEY and "matches the invoice" in item["note"]


async def test_approving_pays_the_invoice_and_moves_paid_through(client, world, monkeypatch, db_session_factory, db_session):
    await world.setup()
    invoice_id, payment_id = await _submitted(client, world, monkeypatch, db_session_factory)
    resp = await client.post(f"/api/v1/admin/owner-payments/{payment_id}/approve", headers=world.admin_h)
    assert resp.status_code == 200 and resp.json()["status"] == "approved"
    (invoice,) = await _row(db_session_factory, OwnerInvoice)
    assert invoice.status == "paid" and invoice.paid_at is not None and invoice.approved_by_user_id == world.admin.id
    (feature,) = await _row(db_session_factory, OwnerFeature)
    assert feature.paid_through == date(2026, 10, 31)
    # the feature is paid once the trial is over
    state = await EntitlementService(db_session, get_settings()).state(world.owner.id, KEY, today=date(2026, 10, 28))
    assert (state.entitled, state.reason) == (True, "paid")
    assert (await _row(db_session_factory, AuditLog, action="owner_payment.approved"))
    assert (await _row(db_session_factory, NotificationLog, event_type="premium_payment_approved"))
    # and the owner now sees the invoice as paid
    assert (await client.get("/api/v1/owners/premium", headers=world.owner_h)).json()["invoices"][0]["status"] == "paid"


async def test_a_lapsed_feature_comes_straight_back_when_paid(client, world, monkeypatch, db_session_factory):
    await world.setup()
    invoice_id, payment_id = await _submitted(client, world, monkeypatch, db_session_factory)
    async with db_session_factory() as session:
        row = (await session.execute(select(OwnerFeature))).scalar_one()
        row.status = "lapsed"
        await session.commit()
    await client.post(f"/api/v1/admin/owner-payments/{payment_id}/approve", headers=world.admin_h)
    (feature,) = await _row(db_session_factory, OwnerFeature)
    assert feature.status == "active" and feature.paid_through == date(2026, 10, 31)


async def test_a_payment_can_only_be_decided_once_even_by_two_admins_at_the_same_time(client, world, monkeypatch, db_session_factory, make_user, make_auth_headers):
    await world.setup()
    invoice_id, payment_id = await _submitted(client, world, monkeypatch, db_session_factory)
    second_admin = await make_auth_headers(await make_user("+923097000009", role=UserRole.ADMIN))
    results = await asyncio.gather(
        client.post(f"/api/v1/admin/owner-payments/{payment_id}/approve", headers=world.admin_h),
        client.post(f"/api/v1/admin/owner-payments/{payment_id}/reject", headers=second_admin, json={"reason": "no"}),
        client.post(f"/api/v1/admin/owner-payments/{payment_id}/approve", headers=second_admin),
    )
    codes = sorted(r.status_code for r in results)
    assert codes == [200, 409, 409], codes
    assert {r.json()["error"]["code"] for r in results if r.status_code == 409} == {"PAYMENT_ALREADY_REVIEWED"}
    (payment,) = await _row(db_session_factory, OwnerPayment)
    (invoice,) = await _row(db_session_factory, OwnerInvoice)
    assert (payment.status == "approved") == (invoice.status == "paid")  # never "approved" with an unpaid invoice or the reverse


async def test_rejecting_reopens_the_invoice_and_the_owner_can_upload_again(client, world, monkeypatch, db_session_factory):
    await world.setup()
    invoice_id, payment_id = await _submitted(client, world, monkeypatch, db_session_factory)
    resp = await client.post(f"/api/v1/admin/owner-payments/{payment_id}/reject", headers=world.admin_h, json={"reason": "Amount is wrong"})
    assert resp.status_code == 200 and resp.json()["rejection_reason"] == "Amount is wrong"
    (feature,) = await _row(db_session_factory, OwnerFeature)
    assert feature.paid_through is None  # nothing was paid
    seen = (await client.get("/api/v1/owners/premium", headers=world.owner_h)).json()["invoices"][0]
    assert seen["status"] == "issued" and seen["last_rejection_reason"] == "Amount is wrong"
    assert (await _upload(client, world.owner_h, invoice_id, png((7, 7, 7)))).status_code == 201  # try again
    assert len(await _row(db_session_factory, OwnerPayment, invoice_id=invoice_id)) == 2
    assert (await _row(db_session_factory, NotificationLog, event_type="premium_payment_rejected"))


async def test_a_reason_is_required_to_reject(client, world, monkeypatch, db_session_factory):
    await world.setup()
    _inv, payment_id = await _submitted(client, world, monkeypatch, db_session_factory)
    assert (await client.post(f"/api/v1/admin/owner-payments/{payment_id}/reject", headers=world.admin_h, json={"reason": ""})).status_code == 422


# --- admin: record outside the app, and reverse -----------------------------------------------------------------------------


async def test_the_admin_can_record_a_payment_received_outside_the_app(client, world, db_session_factory):
    await world.setup()
    invoice_id = await world.invoice()
    queue = (await client.get("/api/v1/admin/owner-invoices", headers=world.admin_h)).json()
    assert [i["id"] for i in queue] == [str(invoice_id)] and queue[0]["total_pkr"] == 700
    resp = await client.post(f"/api/v1/admin/owner-invoices/{invoice_id}/record-payment", headers=world.admin_h, json={"method": "cash", "note": "Paid at the office"})
    assert resp.status_code == 200 and resp.json()["method"] == "cash" and resp.json()["status"] == "approved"
    (invoice,) = await _row(db_session_factory, OwnerInvoice)
    (feature,) = await _row(db_session_factory, OwnerFeature)
    assert invoice.status == "paid" and feature.paid_through == date(2026, 10, 31)
    assert (await _row(db_session_factory, AuditLog, action="owner_payment.recorded"))
    again = await client.post(f"/api/v1/admin/owner-invoices/{invoice_id}/record-payment", headers=world.admin_h, json={"method": "cash"})
    assert again.status_code == 409 and again.json()["error"]["code"] == "INVOICE_NOT_PAYABLE"  # no double recording
    assert len(await _row(db_session_factory, OwnerPayment)) == 1


async def test_recording_is_refused_while_a_screenshot_is_waiting_and_for_a_bad_method(client, world, monkeypatch, db_session_factory):
    await world.setup()
    invoice_id, _payment = await _submitted(client, world, monkeypatch, db_session_factory)
    waiting = await client.post(f"/api/v1/admin/owner-invoices/{invoice_id}/record-payment", headers=world.admin_h, json={"method": "cash"})
    assert waiting.status_code == 409
    assert (await client.post(f"/api/v1/admin/owner-invoices/{invoice_id}/record-payment", headers=world.admin_h, json={"method": "bitcoin"})).status_code == 400


async def test_reversing_a_payment_puts_everything_back_and_keeps_the_trail(client, world, monkeypatch, db_session_factory):
    await world.setup()
    invoice_id, payment_id = await _submitted(client, world, monkeypatch, db_session_factory)
    await client.post(f"/api/v1/admin/owner-payments/{payment_id}/approve", headers=world.admin_h)
    resp = await client.post(f"/api/v1/admin/owner-payments/{payment_id}/reverse", headers=world.admin_h, json={"reason": "Money never arrived"})
    assert resp.status_code == 200 and resp.json()["amount_pkr"] == -700 and resp.json()["status"] == "reversal"
    (invoice,) = await _row(db_session_factory, OwnerInvoice)
    (feature,) = await _row(db_session_factory, OwnerFeature)
    assert invoice.status == "issued" and feature.paid_through is None  # back inside the free trial, nothing paid
    payments = await _row(db_session_factory, OwnerPayment)
    assert sorted(p.amount_pkr for p in payments) == [-700, 700] and sum(p.amount_pkr for p in payments) == 0  # append-only: both rows stay
    assert (await _row(db_session_factory, AuditLog, action="owner_payment.reversed"))
    # a second reversal, or reversing something that was never approved, is refused
    assert (await client.post(f"/api/v1/admin/owner-payments/{payment_id}/reverse", headers=world.admin_h, json={"reason": "again"})).status_code == 409
    approved = (await client.get("/api/v1/admin/owner-payments?status=approved", headers=world.admin_h)).json()
    assert approved[0]["reversed"] is True


async def test_a_submitted_payment_cannot_be_reversed(client, world, monkeypatch, db_session_factory):
    await world.setup()
    _inv, payment_id = await _submitted(client, world, monkeypatch, db_session_factory)
    assert (await client.post(f"/api/v1/admin/owner-payments/{payment_id}/reverse", headers=world.admin_h, json={"reason": "x"})).status_code == 409


# --- the cycle after payment -------------------------------------------------------------------------------------------------


async def test_after_a_paid_invoice_the_next_one_is_a_whole_month_and_the_paid_period_is_not_billed_twice(
    client, world, db_session_factory, db_session
):
    await world.setup()
    invoice_id = await world.invoice()
    await client.post(f"/api/v1/admin/owner-invoices/{invoice_id}/record-payment", headers=world.admin_h, json={"method": "bank_transfer"})
    service = OwnerBillingService(db_session, get_settings())
    assert await service.generate_for_owner(world.owner.id, today=date(2026, 10, 24)) is None  # paid to 31 Oct; 1 Nov is 8 days away
    november = await service.generate_for_owner(world.owner.id, today=date(2026, 10, 25))
    assert (november.period_start, november.period_end, november.total_pkr) == (date(2026, 11, 1), date(2026, 11, 30), 3100)
    assert await service.generate_for_owner(world.owner.id, today=date(2026, 10, 26)) is None  # nothing new is due
    assert len(await _row(db_session_factory, OwnerInvoice)) == 2
