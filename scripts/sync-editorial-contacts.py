"""Refresh the checked-in public website directory (Python 3 + beautifulsoup4).
Run explicitly; normal builds use the reviewed JSON and make no website requests.
"""
import concurrent.futures
import datetime
import json
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
BASE = 'https://bsvnordstern.de/'
catalog = json.loads((ROOT / 'config/bsv-catalog.json').read_text())
teams = {team['slug']: BASE + team['websitePath'].strip('/') + '/' for team in catalog['teams']}
sources = [('Vorstandschaft', BASE + 'verein/vorstandschaft/', None),
           ('Jugendabteilung', BASE + 'jugend/vorstandschaft/', None)]
for slug, label in [('herren-1', '1. Herren'), ('herren-2', '2. Herren'), ('frauen-1', '1. Frauen'), ('frauen-2', '2. Frauen')]:
    sources.append((label, teams[slug], slug))

def extract(source):
    title, url, slug = source
    with urlopen(url, timeout=45) as response:
        if response.status != 200:
            raise RuntimeError(f'{url}: {response.status}')
        soup = BeautifulSoup(response.read(), 'html.parser')
    main = soup.select_one('main')
    if not main:
        raise RuntimeError(f'No main content: {url}')
    people = []
    for heading in main.select('h4, .coach-details h3, .person-copy h2'):
        name = heading.get_text(' ', strip=True)
        card = heading.find_parent('li') or heading.find_parent('article')
        if not card or name.lower() == 'vakant':
            continue
        role = card.select_one('.qualification-wrapper, .coach-details > small, .person-copy > span')
        role = role.get_text(' ', strip=True) if role else ''
        role = role.removesuffix(' ' + name)
        if not role:
            raise RuntimeError(f'Missing role for {name}: {url}')
        existing = next((person for person in people if person['name'] == name), None)
        if existing:
            if role not in existing['role']:
                existing['role'] += ' · ' + role
            continue
        # Website cards have no person IDs. Text fragments target the actual name;
        # browsers without support still open the correct containing page.
        people.append({'name': name, 'role': role, 'websiteUrl': url + '#:~:text=' + quote(name, safe='')})
    if not people:
        raise RuntimeError(f'No people found: {url}; existing directory has not been overwritten')
    return {'title': title, 'websiteUrl': url, 'teamSlug': slug, 'people': people}

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    groups = list(pool.map(extract, sources))
board = groups.pop(0)
# Separate broad sports from board duties and keep the long directory balanced.
broad = [p for p in board['people'] if any(word in p['role'] for word in ['Bogensport', 'Gymnastik', 'Wandern'])]
board['people'] = [p for p in board['people'] if p not in broad]
leadership = {**board, 'title': 'Geschäftsführender Vorstand', 'people': board['people'][:4]}
board['people'] = board['people'][4:]
groups = [leadership, board, groups[0], *groups[1:], {'title': 'Weitere Abteilungen', 'websiteUrl': board['websiteUrl'], 'people': broad}]
groups.append({'title': 'Förderverein', 'websiteUrl': BASE + 'foerderverein/', 'people': [], 'description': 'Projekte unterstützen und gemeinsam mehr ermöglichen.', 'contactUrl': BASE + 'kontakt?thema=foerderverein'})
result = {'sourceUrl': BASE, 'verifiedAt': datetime.date.today().isoformat(), 'teams': teams, 'groups': groups}
(ROOT / 'config/editorial-contacts.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(f"Verified {sum(len(g['people']) for g in groups)} contacts in {len(groups)} groups.")
