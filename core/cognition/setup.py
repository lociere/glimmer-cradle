"""Setuptools hook that prevents removed modules leaking from stale build/lib."""

from __future__ import annotations

import shutil
from pathlib import Path

from setuptools import setup
from setuptools.command.build_py import build_py


class CleanCognitionBuild(build_py):
    def run(self) -> None:
        package_target = Path(self.build_lib) / "glimmer_cradle" / "cognition"
        if package_target.exists():
            shutil.rmtree(package_target)
        super().run()


setup(cmdclass={"build_py": CleanCognitionBuild})
