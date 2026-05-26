"""Sample Python fixture for smoke tests."""
import os
from typing import List, Optional


def hash_for_file(filepath: str, encoding: str = "utf-8") -> str:
    """Compute a hash for the given file."""
    with open(filepath, "r", encoding=encoding) as f:
        content = f.read()
    return compute_content_hash(content)


def compute_content_hash(content: str) -> str:
    """Compute a hash of string content."""
    return str(hash(content))


class FileHasher:
    """A class that hashes files."""

    def __init__(self, algorithm: str = "sha256"):
        self.algorithm = algorithm
        self._cache: dict[str, str] = {}

    def hash_file(self, path: str) -> str:
        if path in self._cache:
            return self._cache[path]
        result = hash_for_file(path)
        self._cache[path] = result
        return result


def main():
    hasher = FileHasher()
    print(hasher.hash_file(__file__))


if __name__ == "__main__":
    main()
