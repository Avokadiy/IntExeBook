#!/usr/bin/env python3
"""Generate the Halloween Special textbook (5 levels x 10 tasks)."""
import json, os, hashlib

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "textbooks", "halloween-special")

def ws(words, size=None):
    """Build a word-search grid containing every word (right / down / diag-down-right)."""
    words = [w.upper() for w in words]
    n = max(len(w) for w in words) + 2 if size is None else size
    while True:
        placed = {}
        ok = True
        for w in words:
            spots = []
            for dy, dx in ((0, 1), (1, 0), (1, 1)):
                for y in range(n):
                    for x in range(n):
                        ey, ex = y + dy * (len(w) - 1), x + dx * (len(w) - 1)
                        if ey >= n or ex >= n:
                            continue
                        fits = True
                        for k in range(len(w)):
                            cy, cx = y + dy * k, x + dx * k
                            if (cy, cx) in placed and placed[(cy, cx)] != w[k]:
                                fits = False
                                break
                        if fits:
                            spots.append((y, x, dy, dx))
            if not spots:
                ok = False
                break
            import random
            y, x, dy, dx = random.choice(spots)
            for k in range(len(w)):
                placed[(y + dy * k, x + dx * k)] = w[k]
        if ok:
            import random as rnd
            letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
            grid = []
            for y in range(n):
                row = ""
                for x in range(n):
                    row += placed.get((y, x), rnd.choice(letters))
                grid.append(row)
            return grid
        n += 1

def _cw_layout(base, slots):
    """One deterministic layout: anchor word ACROSS at row 0; each (word, k) in
    `slots` hangs DOWN from the anchor column x where base[x] == word[k], with
    word[k] occupying row 0 and the rest of the letters filling rows below.
    Every vertical run is isolated (empty cell above/below within rows >= 1)
    and never sits in a column adjacent to another run, so each across/down
    word in the final grid is an unambiguous maximal run for the player engine
    scan (web/app.js engineCrosswords). Returns (cells, clue_words_with_dir)
    or None if this slot assignment collides."""
    cols_used = set()
    placed = []
    for w, k in slots:
        cand = [i for i in range(len(base)) if base[i] == w[k]]
        hit = None
        for x in cand:
            if any(abs(x - u) <= 1 for u in cols_used):
                continue
            top = 1 - k          # letter w[0] sits at row `top`
            bot = len(w) - 1 - k  # last letter's row; row 0 holds w[k]
            ok = True
            for y in range(top, bot + 1):
                if y < 1 and y != 0:
                    ok = False
                    break
                for nbx in (x - 1, x + 1):
                    for (px, ptop, pbot) in placed:
                        if ptop <= y <= pbot:
                            ok = False
                            break
                    if not ok:
                        break
                if not ok:
                    break
            if not ok:
                continue
            hit = (x, top, bot)
            break
        if hit is None:
            return None
        placed.append(hit)
        cols_used.add(hit[0])
    grid = {(i, 0): ch for i, ch in enumerate(base)}
    for (x, top, bot), (w, k) in zip(placed, slots):
        for j, ch in enumerate(w):
            r = j - k
            if r == 0:
                continue  # shared anchor cell already holds this letter
            grid[(x, r)] = ch
    cells = [{"x": x, "y": y, "letter": l} for (x, y), l in sorted(grid.items())]
    out = [(base, "across")] + [(w, "down") for (w, _) in slots]
    return cells, out

def cw(words_with_clues):
    """Public wrapper: tries every word as the across anchor and every simple
    intersection assignment (each down word shares exactly one letter with the
    anchor) until a valid non-colliding layout is found; then attaches clues."""
    import itertools
    items = [(w.upper(), c) for w, c in words_with_clues]
    clue_by_word = dict(items)
    n = len(items)
    for i in range(n):
        base = items[i][0]
        downs = [w for j, (w, _) in enumerate(items) if j != i]
        slot_lists = []
        for w in downs:
            slots = [(w, k) for k, ch in enumerate(w) if ch in base]
            if not slots:
                feasible = False
                break
            slot_lists.append(slots)
        if not feasible:
            continue
        for combo in itertools.product(*slot_lists):
            res = _cw_layout(base, list(combo))
            if res is None:
                continue
            cells, words_dir = res
            clues = [{"word": w, "dir": d, "clue": clue_by_word[w]} for (w, d) in words_dir]
            return cells, clues
    raise ValueError("crossword: no valid layout for " + str([w for w, _ in items]))

def task(tid, ttype, title, instruction, **kw):
    d = {"id": tid, "type": ttype, "title": title, "instruction": instruction}
    d.update(kw)
    return d

units = []

# ---------------- Pre-learners (starters) ----------------
pl_tasks = [
    task("pl1", "multiple-choice", "Trick or treat!", "Choose the correct word.",
         options=["A ghost", "A rocket", "A toast"], answerIndex=0,
         explanation="It is a ghost! 👻"),
    task("pl2", "true-false", "Pumpkin", "True or false?",
         text="A pumpkin is orange.", answer=True,
         explanation="Pumpkins are usually orange. 🎃"),
    task("pl3", "matching", "Word and picture", "Match the word to its picture name.",
         pairs=[{"left": "🎃", "right": "pumpkin"},
                {"left": "🦇", "right": "bat"},
                {"left": "🕷️", "right": "spider"},
                {"left": "🍬", "right": "candy"}]),
    task("pl4", "choose-odd-one-out", "Which one is different?", "Tap the word that is not an animal.",
         options=[{"text": "cat", "isOdd": False}, {"text": "bat", "isOdd": False},
                  {"text": "owl", "isOdd": False}, {"text": "ball", "isOdd": True}],
         categoryHint="animals",
         explanation="A ball is a toy, not an animal!"),
    task("pl5", "word-search", "Hidden animals", "Find the animals in the grid.",
         words=["CAT", "OWL", "BAT", "SPIDER"],
         grid=ws(["CAT", "OWL", "BAT", "SPIDER"], 9)),
    task("pl6", "spelling", "Spell the witch", "Listen (🔊) and spell the word.",
         prompt="Say it: WITCH. Now type it:", word="witch"),
    task("pl7", "listen-choice", "Listen and choose", "Press 🔊 and choose what you hear.",
         text="I see a black cat.", options=["I see a black cat.", "I see a big hat.", "I like the bat."],
         answerIndex=0),
    task("pl8", "click-on-picture", "Find the candy", "Click on the candy spot.",
         image="", hotspots=[{"label": "candy 🍬", "x": 70, "y": 60, "r": 12}],
         explanation="Sweet candy! Don't eat too many before dinner 😉"),
    task("pl9", "translate-match", "Russian and English", "Match the Russian word to the English word.",
         pairs=[{"left": "тыква", "right": "pumpkin"},
                {"left": "привидение", "right": "ghost"},
                {"left": "маска", "right": "mask"},
                {"left": "конфета", "right": "sweet"}]),
    task("pl10", "memory-pairs", "Memory game", "Flip the cards and find matching pairs.",
         pairs=[{"front": "🎃", "back": "pumpkin"},
                {"front": "👻", "back": "ghost"},
                {"front": "🦇", "back": "bat"},
                {"front": "🕷️", "back": "spider"}]),
]
units.append({
    "id": "pre", "title": "Pre-learners — Spooky Starter 🌟",
    "lessons": [{"id": "pre-l1", "title": "Halloween Fun for Little Ones", "page": 1, "tasks": pl_tasks}]
})

# ---------------- A1 ----------------
a1_tasks = [
    task("a11", "multiple-choice", "Costume time", "Choose the correct answer.",
         options=["put on", "look after", "get up", "wake up"], answerIndex=0,
         explanation="At Halloween children PUT ON their costumes. 🧛"),
    task("a12", "gap-fill", "The haunted house", "Fill in the gaps.",
         text="Tom ___ into the old house. It is very ___. Suddenly he ___ a ghost! The ghost says: \"___ or treat!\"",
         blanks=[{"answers": ["goes", "walks"], "hint": "moves with his legs"},
                 {"answers": ["dark", "black"], "hint": "no light"},
                 {"answers": ["sees", "meets"], "hint": "looks at and notices"},
                 {"answers": ["Trick", "trick"], "hint": "the famous Halloween word"}],
         explanation="Tom goes into the old house. It is very dark. Suddenly he sees a ghost! The ghost says: \"Trick or treat!\""),
    task("a13", "word-order", "Build the sentence", "Put the words in the correct order.",
         words=["like", "I", "Halloween", "!"], answer="I like Halloween !",
         explanation="I like Halloween!"),
    task("a14", "true-false", "Halloween facts", "True or false?",
         text="Halloween is celebrated on the 31st of October.", answer=True,
         explanation="Yes! Halloween night is on October 31."),
    task("a15", "matching", "Things and places", "Match the things to where you find them at Halloween.",
         pairs=[{"left": "pumpkin", "right": "the garden"},
                {"left": "candles", "right": "the window"},
                {"left": "costume", "right": "the wardrobe"},
                {"left": "candy", "right": "a big bag"}]),
    task("a16", "word-search", "Party words", "Find five Halloween words.",
         words=["MASK", "PARTY", "CANDY", "GHOST", "WITCH"],
         grid=ws(["MASK", "PARTY", "CANDY", "GHOST", "WITCH"], 10)),
    task("a17", "short-answer", "Answer the question", "Write a short answer.",
         question="What do children wear on Halloween night?",
         answers=["costume", "costumes", "a costume"],
         model="Children wear funny or scary costumes."),
    task("a18", "dictation", "Listen and write", "Listen (🔊) and type exactly what you hear.",
         text="The spooky spider is under the bed."),
    task("a19", "categorize", "Sort the words", "Put the words into two groups.",
         categories=[{"name": "🧙 Scary things", "items": ["ghost", "witch", "spider", "haunted house"]},
                     {"name": "🍭 Sweet things", "items": ["candy", "chocolate", "apple", "cake"]}]),
    task("a110", "initials", "Words from letters", "Complete the words using the first letter.",
         items=[{"initial": "P", "word": "pumpkin"},
                {"initial": "B", "word": "bat"},
                {"initial": "O", "word": "owl"},
                {"initial": "C", "word": "candle"}]),
]
units.append({
    "id": "a1", "title": "A1 — Halloween Night 🌙",
    "lessons": [{"id": "a1-l1", "title": "Spooky Stories for Beginners", "page": 1, "tasks": a1_tasks}]
})

# ---------------- A2 ----------------
a2_tasks = [
    task("a21", "reading-truefalse", "Read and judge", "Read the text, then decide TRUE or FALSE.",
         passage=("Every year on October 31 people in many countries celebrate Halloween. "
                  "Children wear scary costumes and go trick-or-treating in the streets. "
                  "Families carve jack-o'-lanterns from pumpkins and put candles inside them. "
                  "People also tell ghost stories and visit haunted houses. Halloween always "
                  "falls on the same date, so nobody needs to remember a new day each year."),
         statements=[{"text": "Halloween is celebrated in autumn.", "answer": True},
                     {"text": "Adults go trick-or-treating alone.", "answer": False},
                     {"text": "Jack-o'-lanterns are made from pumpkins.", "answer": True},
                     {"text": "The date of Halloween changes every year.", "answer": False}]),
    task("a22", "multiple-select", "Scary monsters", "Choose ALL the Halloween monsters.",
         options=[{"text": "vampire", "correct": True}, {"text": "zombie", "correct": True},
                  {"text": "dolphin", "correct": False}, {"text": "mummy", "correct": True},
                  {"text": "parrot", "correct": False}]),
    task("a23", "error-correction", "Spot the mistake", "Click the wrong word and fix it.",
         sentence="Yesterday we went to a scare fair and I buyed a mask.",
         wrongIndex=6, fix="bought",
         explanation="Past simple of 'buy' is 'bought'. Also: 'scary fair', but here the verb was the target."),
    task("a24", "gap-fill", "Ghost story", "Complete the story with the correct forms.",
         text="Last night, while I ___ (walk) home, I ___ (hear) a strange noise behind me. My heart was ___ (beat) very fast!",
         blanks=[{"answers": ["was walking"], "hint": "past continuous"},
                 {"answers": ["heard"], "hint": "past simple of 'hear'"},
                 {"answers": ["was beating", "beat"], "hint": "long action in the past"}],
         explanation="was walking / heard / was beating"),
    task("a25", "definition-match", "Definitions", "Match the word to its definition.",
         pairs=[{"front": "haunted house", "back": "a house where ghosts appear"},
                {"front": "trick-or-treat", "back": "children ask for sweets door to door"},
                {"front": "costume", "back": "special clothes you wear for fun"},
                {"front": "jack-o'-lantern", "back": "a carved pumpkin with a candle"}]),
    task("a26", "reorder-text", "Story order", "Click the sentences in the correct order.",
         lines=["Mum switched off all the lights.", "We hid behind the sofa with our masks on.",
                "Grandpa opened the door and saw two 'monsters'.", "Everybody laughed and ate cake."],
         explanation="First the lights, then hiding, then grandpa opens the door, finally everyone laughs."),
    dict(task("a27", "crosswords", "Mini crossword", "Solve the crossword."),
         **dict(zip(("cells", "clues"), cw([
             ("haunted", "Adjective for a house full of ghosts"),
             ("net", "Grandma caught three bats in a garden ___"),
             ("nun", "A ghostly sister haunted the old abbey corridors"),
         ])))),
    task("a28", "word-search", "In the haunted forest", "Find six words.",
         words=["FOREST", "GRAVE", "MOON", "SHADOW", "CAULDRON", "BROOM"],
         grid=ws(["FOREST", "GRAVE", "MOON", "SHADOW", "CAULDRON", "BROOM"], 12)),
    task("a29", "sentence-transform", "Rewrite it", "Rewrite the sentence in the past simple.",
         source="We carve a pumpkin every October.",
         task="Start with: Yesterday...",
         answers=["we carved a pumpkin last october", "yesterday we carved a pumpkin",
                  "we carved a pumpkin yesterday"],
         explanation="carve → carved; 'every October' → 'yesterday/last October'."),
    task("a210", "listen-gap", "Watch and fill", "Listen (🔊) and fill in the missing words.",
         text="Happy Halloween! Watch a scary film and eat some ___, but don't forget: ___ or treat!",
         blanks=[{"answers": ["popcorn", "sweets", "candy"]}, {"answers": ["trick"]}],
         explanation="...eat some popcorn, but don't forget: trick or treat!"),
]
units.append({
    "id": "a2", "title": "A2 — Monster Party 🧟",
    "lessons": [{"id": "a2-l1", "title": "Tales of the Haunted Town", "page": 1, "tasks": a2_tasks}]
})

# ---------------- B1 ----------------
b1_tasks = [
    task("b11", "reading-truefalse", "The history of Halloween", "Read and judge the statements.",
         passage=("Halloween grew out of the ancient Celtic festival of Samhain, which marked "
                  "the end of the harvest season and the beginning of winter. The Celts believed "
                  "that on the night of October 31 the boundary between the living and the dead "
                  "became blurred, so they lit huge bonfires and wore animal skins to confuse "
                  "restless spirits. When Irish immigrants brought the tradition to America in the "
                  "19th century, cheap and plentiful pumpkins replaced turnips as lanterns. "
                  "'Trick-or-treating' developed later, partly from the medieval practice of "
                  "'guising', where people performed small tricks in exchange for food. Today "
                  "Halloween is a multi-billion-dollar holiday, yet its central idea remains the "
                  "same: one night a year when people enjoy being frightened."),
         statements=[{"text": "Samhain celebrated the start of the harvest.", "answer": False},
                     {"text": "The Celts thought spirits could walk the earth on that night.", "answer": True},
                     {"text": "Pumpkins were used as lanterns before turnips in Ireland.", "answer": False},
                     {"text": "Trick-or-treating has links to medieval customs.", "answer": True},
                     {"text": "Modern Halloween has lost its original idea completely.", "answer": False}]),
    task("b12", "multiple-select", "Superstitions", "Select all typical Halloween superstitions.",
         options=[{"text": "If you meet a black cat, your luck may change", "correct": True},
                  {"text": "Peeling an apple in one long strip shows your future partner's initial", "correct": True},
                  {"text": "You must sleep with a mirror under your pillow", "correct": False},
                  {"text": "Seeing a spider on Halloween night means a loved one is watching over you", "correct": True},
                  {"text": "Counting stars makes wishes come true only in December", "correct": False}]),
    task("b13", "error-correction", "Grammar doctor", "Find and fix the mistake.",
         sentence="If I were a bat, I would flew every night.",
         wrongIndex=7, fix="fly",
         explanation="After 'would' we use the bare infinitive: would fly."),
    task("b14", "gap-fill", "Collocations", "Complete with the right preposition or noun.",
         text="The ghost story sent shivers ___ my spine. Legend has ___ that the castle is haunted ___ centuries.",
         blanks=[{"answers": ["down"], "hint": "shivers travel this way"},
                 {"answers": ["it"], "hint": "legend has ___"},
                 {"answers": ["for", "since"], "hint": "present perfect time marker"}],
         explanation="shivers down my spine / legend has it / haunted for centuries"),
    task("b15", "definition-match", "Advanced vocabulary", "Match the word to its meaning.",
         pairs=[{"front": "restless spirits", "back": "souls that cannot find peace"},
                {"front": "blurred boundary", "back": "an unclear dividing line"},
                {"front": "bonfire", "back": "a large outdoor fire"},
                {"front": "guising", "back": "disguised performers asking for treats"},
                {"front": "harvest", "back": "the season of gathering crops"}]),
    task("b16", "word-order", "Complex sentence", "Unjumble the reported speech.",
         words=["said", "She", "she", "had", "seen", "a", "ghost", "."],
         answer="She said she had seen a ghost .",
         explanation="Reported speech: She said (that) she had seen a ghost."),
    task("b17", "reorder-text", "Plot of the short story", "Order the events of the story.",
         lines=["Elena moved into the old Victorian house.", "Objects started moving on their own.",
                "She found a hidden diary in the wall.", "The diary explained the maid's tragic death.",
                "Elena held a small ceremony and the house fell silent."],
         explanation="Setup → problem → discovery → revelation → resolution."),
    task("b18", "short-answer", "Open question", "Answer in 1–2 full sentences.",
         question="Why do you think people enjoy being scared on Halloween?",
         answers=["adrenaline", "safe way to feel fear", "excitement", "because it is fun to feel fear safely",
                  "thrill"],
         model="Because it gives an adrenaline rush in a safe situation — you can enjoy fear without real danger."),
    dict(task("b19", "crosswords", "Vocabulary crossword", "Solve the crossword."),
         **dict(zip(("cells", "clues"), cw([
             ("midnight", "The spookiest hour of the night"),
             ("cauldron", "The witch stirred the bubbling ___"),
             ("ink", "She wrote the spell in black ___"),
             ("nit", "An old fairy-tale curse named after a tiny ___"),
         ])))),
    task("b110", "timeline", "Chronology", "Place the events in chronological order.",
         events=[{"label": "Celtic festival of Samhain", "date": "around 2000 years ago"},
                 {"label": "All Saints' Day named by the Church", "date": "609 AD onward"},
                 {"label": "Irish immigrants bring traditions to America", "date": "1840s"},
                 {"label": "Mass-produced Halloween cards and costumes", "date": "1900s"},
                 {"label": "Multi-billion-dollar modern holiday", "date": "today"}]),
]
units.append({
    "id": "b1", "title": "B1 — Legends & Lore 📜",
    "lessons": [{"id": "b1-l1", "title": "From Samhain to Supermarkets", "page": 1, "tasks": b1_tasks}]
})

# ---------------- B2 ----------------
b2_tasks = [
    task("b21", "reading-truefalse", "The economics of fear", "Read and judge.",
         passage=("Psychologists distinguish 'recreational fear' — horror experiences sought out "
                  "voluntarily — from trauma, which is imposed. Studies of haunted-house visitors "
                  "show that excitable personalities report greater enjoyment, suggesting the "
                  "pleasure comes less from the stimulus itself than from the sense of mastery: "
                  "surviving the scare confirms our competence. Economists add another layer. "
                  "Fear-inducing entertainment generates outsized revenue precisely because its "
                  "physiological arousal — elevated heart rate, dopamine release — is shared "
                  "socially; co-regulation turns individual alarm into group bonding. Critics "
                  "counter that commercialised horror flattens the folkloric function of "
                  "Halloween, which historically processed collective anxieties about death and "
                  "the changing seasons through ritual rather than profit."),
         statements=[{"text": "Recreational fear is chosen freely by the experiencer.", "answer": True},
                     {"text": "Research links enjoyment purely to the intensity of the scare.", "answer": False},
                     {"text": "Shared physiological arousal can strengthen social bonds.", "answer": True},
                     {"text": "Critics argue commercial horror preserves folklore's function.", "answer": False}]),
    task("b22", "multiple-select", "Lexical precision", "Select every sentence using the word correctly.",
         options=[{"text": "The plot was predictable, but the cinematography was superb.", "correct": True},
                  {"text": "His fear of spiders is a rational phobia.", "correct": False},
                  {"text": "The film relies on atmosphere rather than gore.", "correct": True},
                  {"text": "She made a jump scare out of nowhere.", "correct": False},
                  {"text": "The ending left more questions than it answered.", "correct": True}]),
    task("b23", "error-correction", "Style editor", "Click the unnatural/incorrect word and fix it.",
         sentence="Hardly had we entered the cellar than we heard a scream.",
         wrongIndex=6, fix="when",
         explanation="'Hardly ... when' (not 'than'). 'No sooner ... than' uses 'than'."),
    task("b24", "sentence-transform", "Inversion", "Rewrite starting with the word in brackets.",
         source="We had barely entered the cellar when we heard a scream.",
         task="Begin with: Hardly ...",
         answers=["hardly had we entered the cellar when we heard a scream"],
         explanation="Hardly had + subject + past participle ... when + past simple."),
    task("b25", "gap-fill", "Idioms", "Complete the idioms.",
         text="When the torch flickered, my blood ran ___. I decided to play it ___ and stayed outside. Honestly, the whole thing was a complete red ___.",
         blanks=[{"answers": ["cold"], "hint": "my blood ran ___"},
                 {"answers": ["safe"], "hint": "play it ___"},
                 {"answers": ["herring"], "hint": "a misleading clue: red ___"}],
         explanation="blood ran cold / play it safe / red herring"),
    task("b26", "definition-match", "Literary terms", "Match term to definition.",
         pairs=[{"front": "unreliable narrator", "back": "a storyteller whose credibility is compromised"},
                {"front": "foreshadowing", "back": "early hints of later events"},
                {"front": "red herring", "back": "a false clue diverting attention"},
                {"front": "denouement", "back": "the final resolution of the plot"},
                {"front": "gothic", "back": "mood of decay, mystery and dread"}]),
    task("b27", "reorder-text", "Narrative arc", "Arrange the paragraphs of the micro-story.",
         lines=["The invitation arrived without a signature.", "Curious despite myself, I accepted.",
                "At midnight the host proposed a game of hide-and-seek.",
                "I hid in the library and heard my own name whispered.",
                "The next morning I found my handwriting in the guestbook — dated 1924."],
         explanation="Classic ghost-story arc: hook → decision → event → climax → twist."),
    task("b28", "short-answer", "Discussion", "Give a considered answer (2–3 sentences).",
         question="Is it ethical to market extreme horror to teenagers? Justify your view.",
         answers=["age rating", "consent", "vulnerable", "desensitis", "desensitiz", "parental", "freedom of choice"],
         model="Arguably no: adolescents are still developing risk assessment, so marketing designed to exploit arousal bypasses informed consent — age ratings and parental gates help."),
    dict(task("b29", "crosswords", "Advanced crossword", "Solve the crossword."),
         **dict(zip(("cells", "clues"), cw([
             ("spectre", "A ghost seen before dawn"),
             ("rest", "Peace the restless spirits never found"),
             ("rites", "Old ceremonies held on October 31"),
             ("arc", "Curved line — or a section of a story's plot"),
         ])))),
    task("b210", "word-search", "Roots of fear", "Find seven advanced words.",
         words=["AROUSAL", "PHOBIA", "MACABRE", "DREAD", "UNEASY", "SPIRIT", "LORE"],
         grid=ws(["AROUSAL", "PHOBIA", "MACABRE", "DREAD", "UNEASY", "SPIRIT", "LORE"], 12)),
]
units.append({
    "id": "b2", "title": "B2 — The Psychology of Fear 🧠",
    "lessons": [{"id": "b2-l1", "title": "Why We Love Being Scared", "page": 1, "tasks": b2_tasks}]
})

manifest = {
    "format": 1,
    "id": "halloween-special",
    "packageId": "pkg-halloween2026001",
    "revision": 1,
    "title": "Halloween Special 🎃",
    "subtitle": "Interactive quests for every level",
    "level": "Pre-learners – B2",
    "publisher": "",
    "author": "IntExeBook Team",
    "description": "Five spooky topics — one per CEFR level (Pre-learners, A1, A2, B1, B2), each with 10 different interactive exercises: word searches, crosswords, ghosts, riddles and grammar for all tastes.",
    "color": "#f97316",
    "icon": "🎃",
    "student": "Student's Book",
    "created": "2026-10-26",
}

student = {"format": 1, "units": units}

# deterministic fingerprint (mirrors packFingerprint over student content)
payload = json.dumps(student, sort_keys=True, ensure_ascii=False)
manifest["fingerprint"] = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]

os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
with open(os.path.join(OUT, "student.json"), "w", encoding="utf-8") as f:
    json.dump(student, f, ensure_ascii=False, indent=2)

total = sum(len(l["tasks"]) for u in units for l in u["lessons"])
print(f"OK: {len(units)} units, {total} tasks -> {OUT}")
