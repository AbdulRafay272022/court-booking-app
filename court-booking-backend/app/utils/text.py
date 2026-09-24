import difflib
import re


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "venue"


_NAME_TOKEN_RE = re.compile(r"[a-z]+")


def _name_tokens(name: str) -> list[str]:
    return _NAME_TOKEN_RE.findall(name.lower())


def fuzzy_name_match(a: str | None, b: str | None) -> bool:
    """Tolerant name comparison for payment-proof review (Section 32 Part 7):
    case-insensitive, word-order-insensitive, tolerates one side abbreviating
    a token to an initial ("Ali Raza" vs "Ali R."), and tolerates minor
    spelling drift -- Roman Urdu has no single fixed spelling -- via a
    whole-string similarity ratio. This is a heuristic to reduce false
    "mismatch" warnings, not a verification: the caller must never treat a
    `False` result as proof of anything (people legitimately pay from a
    relative's account), only as a prompt for the owner to look closer."""
    if not a or not b:
        return False
    tokens_a, tokens_b = _name_tokens(a), _name_tokens(b)
    if not tokens_a or not tokens_b:
        return False
    if tokens_a == tokens_b or set(tokens_a) == set(tokens_b):
        return True

    short, long_ = (tokens_a, tokens_b) if len(tokens_a) <= len(tokens_b) else (tokens_b, tokens_a)
    # Only apply position-wise initials tolerance when the two names are
    # close in length -- otherwise a single-token name like "Ali" would
    # spuriously "match" any longer name that merely starts with the same
    # first word ("Ali Raza Khan Sons"), which is a real false positive, not
    # tolerance.
    if len(short) >= 2 and len(long_) - len(short) <= 1:
        matched = sum(
            1
            for s_tok, l_tok in zip(short, long_)
            if s_tok == l_tok
            or (len(s_tok) == 1 and l_tok.startswith(s_tok))
            or (len(l_tok) == 1 and s_tok.startswith(l_tok))
        )
        if matched == len(short):
            return True

    ratio = difflib.SequenceMatcher(None, " ".join(tokens_a), " ".join(tokens_b)).ratio()
    return ratio >= 0.72
