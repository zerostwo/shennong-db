#!/opt/tiledb/bin/python
import argparse
import json
from pathlib import Path

import h5py
import numpy as np
import tiledb


def text(values):
    return [value.decode() if isinstance(value, bytes) else str(value) for value in values]


def describe(uri):
    with tiledb.open(uri, "r") as array:
        return {
            "uri": uri,
            "backend": "tiledb",
            "cells": int(array.meta["cell_count"]),
            "features": int(array.meta["feature_count"]),
            "nonzero_values": int(array.meta["nonzero_values"]),
        }


def ingest(source, uri):
    if tiledb.array_exists(uri):
        return describe(uri)
    Path(uri).parent.mkdir(parents=True, exist_ok=True)
    with h5py.File(source, "r") as handle:
        matrix = handle["matrix"]
        feature_count, cell_count = map(int, matrix["shape"][:])
        values = matrix["data"][:].astype(np.int32, copy=False)
        genes = matrix["indices"][:].astype(np.int32, copy=False)
        pointers = matrix["indptr"][:]
        cells = np.repeat(np.arange(cell_count, dtype=np.int32), np.diff(pointers))
        feature_ids = text(matrix["features/id"][:])
        feature_names = text(matrix["features/name"][:])
        barcodes = text(matrix["barcodes"][:])

    domain = tiledb.Domain(
        tiledb.Dim(name="feature", domain=(0, feature_count - 1), tile=min(feature_count, 2048), dtype=np.int32),
        tiledb.Dim(name="cell", domain=(0, cell_count - 1), tile=min(cell_count, 2048), dtype=np.int32),
    )
    schema = tiledb.ArraySchema(domain=domain, sparse=True, attrs=[tiledb.Attr(name="value", dtype=np.int32)])
    tiledb.SparseArray.create(uri, schema)
    with tiledb.open(uri, "w") as array:
        array[genes, cells] = {"value": values}
        array.meta["feature_count"] = feature_count
        array.meta["cell_count"] = cell_count
        array.meta["nonzero_values"] = len(values)
        array.meta["feature_ids"] = json.dumps(feature_ids)
        array.meta["feature_names"] = json.dumps(feature_names)
        array.meta["barcodes"] = json.dumps(barcodes)
    return describe(uri)


def query(uri, feature, limit, offset=0):
    with tiledb.open(uri, "r") as array:
        feature_ids = json.loads(array.meta["feature_ids"])
        feature_names = json.loads(array.meta["feature_names"])
        barcodes = json.loads(array.meta["barcodes"])
        try:
            feature_index = feature_ids.index(feature)
        except ValueError:
            try:
                feature_index = feature_names.index(feature)
            except ValueError as error:
                raise SystemExit(f"feature not found: {feature}") from error
        result = array.query(attrs=["value"], coords=True).multi_index[feature_index, slice(None)]
    order = np.argsort(result["cell"])
    rows = []
    for index in order[offset:offset + limit]:
        cell = int(result["cell"][index])
        rows.append({
            "observation_id": barcodes[cell],
            "cell_id": barcodes[cell],
            "feature_id": feature_ids[feature_index],
            "feature_symbol": feature_names[feature_index],
            "feature": feature_names[feature_index],
            "measure": "count",
            "value": int(result["value"][index]),
        })
    return {
        "status": "success",
        "data": rows,
        "meta": {
            "backend": "tiledb",
            "n_rows": len(rows),
            "total_rows": len(order),
            **({"next_cursor": str(offset + limit)} if offset + limit < len(order) else {}),
            "feature_id": feature_ids[feature_index],
            "feature_symbol": feature_names[feature_index],
            "columns": ["cell_id", "feature_id", "feature_symbol", "value"],
        },
    }


def resolve(uri, feature):
    with tiledb.open(uri, "r") as array:
        feature_ids = json.loads(array.meta["feature_ids"])
        feature_names = json.loads(array.meta["feature_names"])
    query_value = feature.casefold()
    matches = []
    for feature_id, feature_name in zip(feature_ids, feature_names):
        stable_id = feature_id.split(".", 1)[0]
        if query_value in {feature_id.casefold(), stable_id.casefold(), feature_name.casefold()}:
            matches.append({
                "original_id": feature_id,
                "stable_id": stable_id,
                "symbol": feature_name,
            })
    return {"matches": matches}


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    ingest_parser = commands.add_parser("ingest")
    ingest_parser.add_argument("--source", required=True)
    ingest_parser.add_argument("--uri", required=True)
    query_parser = commands.add_parser("query")
    query_parser.add_argument("--uri", required=True)
    query_parser.add_argument("--feature", required=True)
    query_parser.add_argument("--limit", type=int, default=1000)
    query_parser.add_argument("--offset", type=int, default=0)
    resolve_parser = commands.add_parser("resolve")
    resolve_parser.add_argument("--uri", required=True)
    resolve_parser.add_argument("--feature", required=True)
    describe_parser = commands.add_parser("describe")
    describe_parser.add_argument("--uri", required=True)
    arguments = parser.parse_args()
    if arguments.command == "ingest":
        output = ingest(arguments.source, arguments.uri)
    elif arguments.command == "query":
        output = query(arguments.uri, arguments.feature, max(1, min(arguments.limit, 100000)), max(0, arguments.offset))
    elif arguments.command == "resolve":
        output = resolve(arguments.uri, arguments.feature)
    else:
        output = describe(arguments.uri)
    print(json.dumps(output, separators=(",", ":")))


if __name__ == "__main__":
    main()
