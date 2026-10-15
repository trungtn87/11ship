import re
import sys
actual = set(re.findall(r"uses-permission(?:-sdk-\d+)?: name='([^']+)'", open(sys.argv[1]).read()))
expected = {'INTERNET', 'ACCESS_NETWORK_STATE', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION', 'POST_NOTIFICATIONS', 'WAKE_LOCK'}
assert actual == {'android.permission.' + p for p in expected}, actual
print('APK permissions match GPS test scope')
