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

6. audio-choice / audio-transcribe / video-task / reading / click-image /
   wordsearch / find-odd-one-out / click-words / translation-match
   (see web/shared.js TASK_TYPES for the exact data shape of each)

## Media (audio / video / images) — how to include it

Put all media files into the `assets/` folder of the pack (any subfolders are
fine, e.g. `assets/audio/u1-l1.mp3`). Then reference them from a task with the
`media` array:

    { "id":"t6", "type":"multiple-choice", "title":"Listen & choose",
      "instruction":"What do you hear?",
      "options":["cat","dog","fish"], "answerIndex":0,
      "media":[ { "type":"audio", "src":"assets/audio/u1-l1.mp3" },
                { "type":"image", "src":"assets/img/pic1.png", "alt":"optional" } ] }

Rules:
* `type` must be `"audio"`, `"video"` or `"image"`.
* `src` is a path relative to the pack root (starts with `assets/`).
  Absolute http(s)/data URLs also work but won't travel inside the zip.
* A task can carry several media items; they render above the question in order.
* Supported formats: mp3/wav/ogg/m4a (audio), mp4/webm (video), png/jpg/webp/gif/svg (images).

## Packaging your textbook for import

Zip the folder so that `manifest.json` sits at the archive root (or inside one
top-level folder):

    my-book.zip
        manifest.json
        student.json
        workbook.json          (optional)
        assets/...             (all media)

Then either drop the zip into `textbooks/` and restart the server, or use the
in-app page "📚 Import textbook (.zip)" (#/import-zip). Max size: 512 MB.

Tip: keep task ids (`t1`, `t2`, ...) unique inside one lesson.
