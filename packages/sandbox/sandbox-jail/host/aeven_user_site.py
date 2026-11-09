"""Lets a jailed account install Python packages beside the read-only image.

`install-egress.sh` puts this module and a `.pth` line importing it into the image's site-packages, so every
interpreter of the image runs it at start-up. It makes `pip install` write under the caller's `~/.local` by default,
and puts that folder's site-packages on the import path after the image's own, so an installed package never
replaces one the image ships. The Python zygote repeats both steps for each run, whose home is its caller's.
"""
import os
import site

os.environ.setdefault('PIP_PREFIX', os.path.join(os.path.expanduser('~'), '.local'))
# A virtual environment without system packages disables the user site; the zygote reads this flag per run.
site.ENABLE_USER_SITE = True
if os.path.isdir(site.getusersitepackages()):
    site.addsitedir(site.getusersitepackages())
