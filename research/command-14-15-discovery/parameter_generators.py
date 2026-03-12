"""Re-export from shared module. Original moved to research/_shared/."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "_shared"))
from parameter_generators import *  # noqa: F401,F403,E402
