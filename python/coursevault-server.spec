# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for CourseVault Server

Bundles course_library_server.py and all its local module imports
into a single directory executable.

Build: pyinstaller coursevault-server.spec
Output: dist/coursevault-server/coursevault-server.exe
"""

import sys
import os

block_cipher = None

# Collect all local Python modules that the server imports
local_modules = [
    'course_library_server.py',
    'transcriber.py',
    'video_summaries.py',
    'course_summary.py',
    'summarizer.py',
    'chat.py',
    'query.py',
    'generate_index.py',
    'staged_processor.py',
]

a = Analysis(
    ['course_library_server.py'],
    pathex=['.'],
    binaries=[],
    datas=[],
    hiddenimports=[
        # Standard library modules that may be dynamically imported
        'http.server',
        'socketserver',
        'json',
        'pathlib',
        'hashlib',
        'threading',
        'concurrent.futures',
        'urllib.request',
        'urllib.error',
        'urllib.parse',
        'dataclasses',
        'queue',
        'uuid',
        'base64',
        'ctypes',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude unnecessary stdlib modules to reduce size
        'tkinter',
        'unittest',
        'pydoc',
        'doctest',
        'test',
        'distutils',
        'setuptools',
        'pip',
        'ensurepip',
        'venv',
        'lib2to3',
        'idlelib',
        'turtledemo',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='coursevault-server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,  # Need console for subprocess communication
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.path.join('..', 'resources', 'icon.png') if os.path.exists(os.path.join('..', 'resources', 'icon.png')) else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='coursevault-server',
)
