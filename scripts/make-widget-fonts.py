# Regenerates the widgets' fonts (android/app/src/main/res/font/google_sans_*.ttf, backlog 13):
# static Google Sans instances at weights 400, 500 and 700 (opsz 18, GRAD 0), subset to Google
# Fonts' "latin" range without hinting, about 85 KB each instead of the 5 MB variable font.
#
# Source: GoogleSans[GRAD,opsz,wght].ttf from github.com/google/fonts (ofl/googlesans), SIL Open
# Font License 1.1 with no Reserved Font Name, so the subsets keep the name; the font's name
# table carries the copyright and licence (android/app/src/main/google-sans-OFL.txt).
#
# Usage (needs fonttools: pip install fonttools):
#   python scripts/make-widget-fonts.py GoogleSans[GRAD,opsz,wght].ttf android/app/src/main/res/font
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

src, out = sys.argv[1], sys.argv[2]
LATIN = [*range(0x0000, 0x0100), 0x0131, 0x0152, 0x0153, 0x02BB, 0x02BC, 0x02C6, 0x02DA, 0x02DC,
         0x0304, 0x0308, 0x0329, *range(0x2000, 0x2070), 0x20AC, 0x2122, 0x2191, 0x2193, 0x2212,
         0x2215, 0xFEFF, 0xFFFD]
for weight, name in ((400, 'regular'), (500, 'medium'), (700, 'bold')):
    # recalcTimestamp=False keeps the source's 'head' dates, so the same source gives byte-identical files.
    font = instancer.instantiateVariableFont(TTFont(src, recalcTimestamp=False), {'wght': weight, 'opsz': 18, 'GRAD': 0}, updateFontNames=True)
    opts = subset.Options()
    opts.hinting = False  # Android doesn't use TrueType hinting
    opts.layout_features = ['*']  # keep tnum, case and the rest for the subset glyphs
    opts.name_IDs = ['*']
    opts.name_languages = ['*']
    s = subset.Subsetter(opts)
    s.populate(unicodes=LATIN)
    s.subset(font)
    path = f'{out}/google_sans_{name}.ttf'
    font.save(path)
    f = TTFont(path)
    print(path, f['OS/2'].usWeightClass, f['name'].getDebugName(4), len(f.getGlyphOrder()), 'glyphs')
