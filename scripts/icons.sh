#!/bin/sh
# Rebuilds every icon from the original drawing in arte/.
#
# Needs ImageMagick 7 (`magick`). Run from the repository root after changing
# arte/gorila.png; the results are committed, so this is not part of any build.
set -eu

SOURCE=arte/gorila.png
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# The drawing is pure black on a light background, so the alpha IS the inverted
# luminance — no automatic background removal, which leaves a dirty edge and
# eats into thin parts of the figure.
#
# The level floor matters: the background measures 245-252 rather than pure
# white, and without clipping it the "transparent" area keeps a faint haze that
# only shows up once the icon sits on something dark.
#
# White, not the original black: everywhere this icon appears — the room, the
# app, a dark browser tab, the KDE task bar — the background is dark.
magick "$SOURCE" \
  \( +clone -colorspace gray -negate -level 5%,100% \) \
  -alpha off -compose CopyOpacity -composite \
  -channel RGB -fill white -colorize 100 +channel \
  -trim +repage \
  "$WORK/figure.png"

# Trimmed tight and re-centred in a square with a thin margin. The generous
# frame the original came with is what makes an icon look tiny in a task bar,
# and a non-square icon is stretched by the ones that demand squares.
SIDE=$(magick "$WORK/figure.png" -format "%[fx:round(max(w,h)/0.92)]" info:)
magick "$WORK/figure.png" \
  -background none -gravity center -extent "${SIDE}x${SIDE}" \
  -define png:color-type=6 \
  "$WORK/square.png"

render() {
  magick "$WORK/square.png" -resize "$1x$1" -define png:color-type=6 "$2"
}

render 512 desktop/build/icon.png
render 512 client/public/icon.png
render 32 client/public/favicon.png

echo "icons rebuilt from $SOURCE"
