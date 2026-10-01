#!/bin/sh
# Syntax-checks the joined game script without building the page.
d=$(dirname "$0")/../src
{ cat "$d"/*.js; echo '})();'; } > /tmp/bp-joined.js && node --check /tmp/bp-joined.js && echo "syntax OK"
