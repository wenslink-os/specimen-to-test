import re


def run(data):
    v = data["value"]
    if isinstance(v, (int, float)):
        return float(v).is_integer() and 0 <= v <= 150
    m = re.match(r"[0-9]+", v)
    return m is not None and int(m.group()) <= 150
