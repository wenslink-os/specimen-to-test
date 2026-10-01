import re


def run(data):
    v = data["value"]
    if isinstance(v, (int, float)):
        return float(v).is_integer() and 0 <= v <= 150
    return re.fullmatch(r"[0-9]+", v) is not None and int(v) <= 150
