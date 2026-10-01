import csv


def run(data):
    return next(csv.reader([data["line"]]))
