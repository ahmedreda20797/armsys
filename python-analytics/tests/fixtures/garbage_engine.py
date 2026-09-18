# Failure-isolation fixture: exits 0 but stdout is NOT the JSON envelope
# the bridge expects. (Portable replacement for '/bin/echo'.)
print("this is definitely not the analytics JSON envelope")
