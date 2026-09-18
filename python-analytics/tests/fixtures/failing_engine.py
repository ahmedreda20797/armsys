# Failure-isolation fixture: a real engine invocation that exits non-zero.
# (Portable replacement for '/bin/false' — that binary does not exist on
# Windows, where the fixture previously degraded to PYTHON_UNAVAILABLE.)
import sys

sys.exit(1)
