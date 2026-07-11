import argparse
import json
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument("command")
parser.add_argument("--uri", required=True)
parser.add_argument("--feature", required=True)
parser.add_argument("--limit")
args = parser.parse_args()

if args.uri == "sleep":
    time.sleep(3)
elif args.uri == "exit":
    sys.stderr.write("Traceback: /data/private-array\n")
    raise SystemExit(3)
elif args.uri == "stdout":
    sys.stdout.write("x" * 2048)
    raise SystemExit(0)
elif args.uri == "stderr":
    sys.stderr.write("x" * 2048)
    raise SystemExit(4)

print(json.dumps({"status": "success", "data": [], "meta": {"backend": "tiledb"}}))
