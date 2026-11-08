"""fix/nov-9 item 1: a refund can be sent in parts (owners record each transfer; `refunded_amount` accumulates). Every
screen shows the same three numbers from here: the whole refund, what was sent so far, and what is still owed."""


def refund_parts(dispute) -> dict:
    total = float(dispute.refund_amount or 0)
    sent = float(dispute.refunded_amount or 0)
    if dispute.refund_status != "owed":
        # marked refunded: everything owed has gone back (an older row may have no refunded_amount)
        sent = max(sent, total)
    sent = round(min(sent, total) if total > 0 else sent, 2)
    return {"sent": sent, "remaining": round(max(total - sent, 0.0), 2)}
