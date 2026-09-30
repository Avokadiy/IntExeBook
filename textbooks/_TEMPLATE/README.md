# Textbook pack template

Copy this whole folder (or create a `manifest.json` + content files inside any
new folder / zip archive) into `textbooks/` to add a new textbook.
Folders whose name starts with `_` are ignored by the app, so this template
never shows up in the list.

## Minimal structure

    textbooks/my-book/
        manifest.json     # what the app shows on the home screen
        student.json      # Student's Book  (units -> lessons -> tasks)
        workbook.json     # Workbook         (same schema, optional)
        assets/           # optional images/audio

You can also just drop `my-book.zip` (or `.tar.gz`) containing these files —
the app unpacks it automatically on start / page refresh.

## manifest.json

{
  "id": "my-book",                 // unique, used in URLs
  "title": "My English Course",
  "subtitle": "Grade 5",
  "level": "A1",
  "publisher": "...",
  "description": "Short blurb shown on the card.",
  "color": "#0ea5e9",              // accent colour of the cover
  "icon": "📘",                    // emoji or set "cover": "assets/cover.png"
  "student": "Student's Book",     // key present => SB is offered in step 2
  "workbook": "Workbook",          // key present => WB is offered
  "student_file": "student.json",  // optional, defaults shown here
  "workbook_file": "workbook.json"
}

## Content file schema (student.json / workbook.json)

{
  "units": [
    {
      "id": "u1",
      "title": "Unit 1 — Animals",
      "lessons": [
        {
          "id": "l1",
          "title": "Lesson 1 — Pets",
          "page": 6,
          "tasks": [ ...see below... ]
        }
      ]
    }
  ]
}

## Task types

1. multiple-choice
   { "id":"t1", "type":"multiple-choice", "title":"...", "instruction":"...",
     "options":["a","b","c"], "answerIndex":1, "explanation":"optional" }

2. true-false
   { "id":"t2", "type":"true-false", "title":"...", "instruction":"statement...",
     "answer": true, "explanation":"optional" }

3. gap-fill  (each `___` in "text" becomes one input; order must match "blanks")
   { "id":"t3", "type":"gap-fill", "title":"...", "instruction":"...",
     "text":"I ___ a cat and she ___ black.",
     "blanks":[ {"answers":["have"],"hint":"optional"},
                {"answers":["is","'s"],"hint":"optional"} ] }

4. word-order  (tokens of "answer" must be exactly the shuffled "words")
   { "id":"t4", "type":"word-order", "title":"...", "instruction":"...",
     "words":["is","This","my","cat"], "answer":"This is my cat" }

5. matching  (left column stays in order, right column is shuffled)
   { "id":"t5", "type":"matching", "title":"...", "instruction":"...",
     "pairs":[{"left":"cat","right":"кошка"},{"left":"dog","right":"собака"}] }

Tip: keep task ids (`t1`, `t2`, ...) unique inside one lesson.
