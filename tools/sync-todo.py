"""Materialize the auditable SQL task list; no game/source/save access."""
import sqlite3
from pathlib import Path
root = Path(__file__).resolve().parents[1]
with sqlite3.connect(root / 'docs' / 'todo.sqlite') as connection:
    connection.executescript((root / 'docs' / 'todo.sql').read_text(encoding='utf-8'))
    for row in connection.execute('SELECT id, status FROM todo ORDER BY rowid'):
        print(f'{row[0]}: {row[1]}')
