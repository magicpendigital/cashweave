# No shrinking in this synthetic trial. Retain local Capacitor plugin methods
# if shrinking is introduced during a separately reviewed release.
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
