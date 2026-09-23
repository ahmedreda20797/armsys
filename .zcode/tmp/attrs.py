import io, re, sys

FILES = [
 'src/components/pages/EmployeesPage.tsx',
 'src/components/pages/Employee360Page.tsx',
 'src/components/pages/quality-kpi/ObservationCategoriesPage.tsx',
 'src/components/pages/quality-kpi/ObservationTemplatesPage.tsx',
 'src/components/pages/quality-kpi/QualityAuditLogPage.tsx',
 'src/components/pages/employee360/EmployeePerformanceSection.tsx',
]

ATTR_PAT = re.compile(r'([a-zA-Z]+)="([^"\n]*[\u0600-\u06FF][^"\n]*)"')
COMP_PAT = re.compile(r'^(?:export default )?(?:export )?function (\w+)')
ARROW_PAT = re.compile(r'^const (\w+) = \(\{')

def quote_js(v):
    return v.replace('\\', '\\\\').replace("'", "\\'")

for p in FILES:
    s = io.open(p, encoding='utf-8').read()
    lines = s.split('\n')

    # 1) imports
    if "useLanguage" not in s:
        m = list(re.finditer(r"^import .*?;$", s, re.M))
        ins = m[-1].end()
        add = "\nimport { translateUIText } from '@/lib/i18n/ui-text';\nimport { useLanguage } from '@/lib/i18n/language-context';"
        s = s[:ins] + add + s[ins:]
        lines = s.split('\n')

    # 2) component ranges (function declarations with block bodies)
    comps = []  # (name, start_idx)
    for i, l in enumerate(lines):
        m = COMP_PAT.match(l)
        if m:
            comps.append([m.group(1), i])
        m2 = ARROW_PAT.match(l)
        if m2:
            comps.append([m2.group(1), i])
    comp_starts = sorted(comps, key=lambda c: c[1])

    def owner(idx):
        cur = None
        for name, st in comp_starts:
            if st <= idx:
                cur = (name, st)
            else:
                break
        return cur

    # 3) convert attributes
    converted = set()  # component names needing locale
    for i, l in enumerate(lines):
        if not ATTR_PAT.search(l):
            continue
        own = owner(i)
        if own is None:
            continue
        name, st = own
        converted.add((name, st))
        def sub(m):
            v = quote_js(m.group(2))
            return "{0}={{translateUIText('{1}', locale)}}".format(m.group(1), v)
        lines[i] = ATTR_PAT.sub(sub, l)

    # 4) insert locale destructure per component needing it (skip if already present in body)
    inserted = []
    for name, st in sorted(converted, key=lambda c: -c[1]):
        # find component body end (next component start or EOF)
        idx_next = len(lines)
        for n2, st2 in comp_starts:
            if st2 > st:
                idx_next = min(idx_next, st2)
        body = '\n'.join(lines[st:idx_next])
        if 'locale' in body and 'translateUIText' in body and re.search(r"const \{ locale \} = useLanguage\(\);", body):
            continue
        if 'const { locale } = useLanguage();' in body:
            continue
        # insert after the opening brace line: find first line >= st containing '{' at end of signature
        # function headers may span lines; find first '{' line after st
        j = st
        while j < len(lines) and not lines[j].rstrip().endswith('{'):
            j += 1
        # j is the line ending the signature (or first line with {) — insert after it
        # but ensure we are inside the component body, not a nested object; heuristic: j <= st + 15
        if j > st + 15:
            print('SKIP (long signature):', p, name)
            continue
        lines.insert(j + 1, '  const { locale } = useLanguage();')
        inserted.append(name)

    io.open(p, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
    print(p, '| locale inserted into:', inserted)
