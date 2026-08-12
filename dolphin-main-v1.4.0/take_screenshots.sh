#!/bin/bash
OUTDIR="/Users/junyoung/Desktop/DolphinScreenshots"
SIMID="9C0C5A2A-7F0E-43D1-89F1-AC4998696913"
WIN_X=712
WIN_Y=33
WIN_W=494
WIN_H=1054
TAB_Y=$((WIN_Y + WIN_H - 45))
TAB_W=$((WIN_W / 6))

# Tab center X positions (absolute screen coords)
HOME_X=$((WIN_X + TAB_W/2))
LOUNGE_X=$((WIN_X + TAB_W + TAB_W/2))
MARKET_X=$((WIN_X + TAB_W*2 + TAB_W/2))
LF_X=$((WIN_X + TAB_W*3 + TAB_W/2))
MSG_X=$((WIN_X + TAB_W*4 + TAB_W/2))
MY_X=$((WIN_X + TAB_W*5 + TAB_W/2))

take_shot() {
    local name=$1
    local x=$2
    # Click tab
    osascript -e "tell application \"Simulator\" to activate"
    sleep 0.5
    osascript -e "tell application \"System Events\" to click at {$x, $TAB_Y}"
    sleep 2
    # Screenshot
    xcrun simctl io $SIMID screenshot "$OUTDIR/raw_${name}.png" 2>/dev/null
    # Resize to 6.5" (1284x2778)
    sips -z 2778 1284 "$OUTDIR/raw_${name}.png" --out "$OUTDIR/${name}.png" 2>/dev/null
    echo "✅ $name done"
}

# First dismiss any debug banner by clicking X (top area)
osascript -e "tell application \"Simulator\" to activate"
sleep 0.5

echo "📸 Taking screenshots..."
take_shot "02_Lounge" $LOUNGE_X
take_shot "03_Market" $MARKET_X
take_shot "04_LostFound" $LF_X
take_shot "05_Messages" $MSG_X
take_shot "06_Profile" $MY_X
# Go back to Home for final shot
take_shot "01_Home" $HOME_X

echo "🎉 All screenshots saved to $OUTDIR"
ls -la "$OUTDIR"/*.png | grep -v raw
