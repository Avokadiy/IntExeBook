import json, os

OUT = "textbooks/solutions-elementary"
os.makedirs(OUT + "/assets", exist_ok=True)

def task(tid, ttype, title, instruction, extra=None, media_audio=None):
    t = {"id": tid, "type": ttype, "title": title, "instruction": instruction}
    if extra: t.update(extra)
    if media_audio:
        fname, label = media_audio[0], (media_audio[1] if len(media_audio)>1 else "Track")
        t["media"] = [{"type":"audio","src":"assets/"+fname,"caption":label}]
    return t

sb_units = []
sb_units.append({"id":"starter","title":"Starter Unit","lessons":[
 {"id":"st-vocab","title":"Vocabulary — musical instruments & action verbs","page":6,"tasks":[
  task("st-t1","multiple-choice","Missing instrument","Complete the list of musical instruments: clarinet, drums, flute, guitar, keyboard, piano, saxophone, trumpet, ___",
       {"options":["violin","piano bench","amplifier","drumstick"],"answerIndex":0}),
  task("st-t2","choose-odd-one-out","Odd one out — action verbs","Tap all words that are NOT action verbs from the unit.",
       {"options":[{"text":"dance","isOdd":False},{"text":"skate","isOdd":False},{"text":"guitar","isOdd":True},{"text":"sing","isOdd":False},{"text":"ski","isOdd":False},{"text":"football pitch","isOdd":True}],"categoryHint":"Action verbs: dance, skate, sing, ski…"}),
  task("st-t3","find-and-click","can / can't","Click every word 'can' (including can't) in the dialogue extract.",
       {"text":"She can play the guitar really well. But she can't sing. Can you play the piano like that? No, I can't. But I can play the piano.","targets":["can","can't"],"mode":"words"}),
 ]},
 {"id":"st-grammar","title":"Grammar — can: ability & permission","page":8,"tasks":[
  task("st-t4","gap-fill","Ask for permission","Complete with CAN or CAN'T.",
       {"text":"1. ___ I borrow your pencil, please? 2. No, you ___. 3. She ___ play the drums — she's great! 4. He ___ find his money. 5. ___ I use your dictionary?",
        "blanks":[{"answers":["can"]},{"answers":["can't","cannot"]},{"answers":["can"]},{"answers":["can't"]},{"answers":["can"]}]}),
  task("st-t5","word-order","Word order","Put the words in order to make a sentence.",
       {"words":["Can","I","your","book","share","?"],"answer":"Can I share your book?"}),
  task("st-t6","true-false","Grammar rule","The form of 'can' is different for each person (I can, he cans …).",{"answer":False}),
 ]},
 {"id":"st-listen","title":"Listening — identify the instruments","page":7,"tasks":[
  task("st-t7","multiple-choice","Which instrument? (1)","Listen and choose the instrument you hear. [Audio to be added manually] 🎧",
       {"options":["clarinet","drums","flute","trumpet"],"answerIndex":0},
       media_audio=("starter-track-1.mp3","Starter · track 1")),
  task("st-t8","multiple-choice","Which instrument? (2)","Listen and choose the instrument you hear. [Audio to be added manually] 🎧",
       {"options":["piano","saxophone","violin","keyboard"],"answerIndex":2},
       media_audio=("starter-track-2.mp3","Starter · track 2")),
 ]}]})

unit_meta = {
 1:("Family and friends",[
   ("u1-clans","Vocabulary — family & adjectives + prepositions",16,[
     task("u1-t1","matching","Family adjectives","Match the adjective to its meaning.",
          {"pairs":[{"left":"get on well with","right":"have a good relationship"},{"left":"argue","right":"say angry words to each other"},{"left":"similar to","right":"almost the same as"},{"left":"keen on","right":"very interested in"}]}),
     task("u1-t2","gap-fill","Adjectives + prepositions","Complete the sentences with the correct preposition.",
          {"text":"1. Are you interested___ the same things? 2. Is your brother good___ maths? 3. Are you keen___ football? 4. We are similar___ each other. 5. She is frightened___ spiders.",
           "blanks":[{"answers":["in"],"hint":"interested ___"},{"answers":["at"],"hint":"good ___"},{"answers":["on"],"hint":"keen ___"},{"answers":["to"],"hint":"similar ___"},{"answers":["of"],"hint":"frightened ___"}]}),
     task("u1-t3","translate-match","Learn this! — prepositions","Match the adjective to the preposition it takes.",
          {"pairs":[{"left":"excited","right":"about"},{"left":"famous","right":"for"},{"left":"frightened","right":"of"},{"left":"good","right":"at"},{"left":"pleased","right":"with"}]}),
   ]),
   ("u1-gram","Grammar — present simple",12,[
     task("u1-t4","multiple-choice","Present simple — 3rd person","My sister ___ a lot with her friends.",
          {"options":["argue","argues","arguing","is argue"],"answerIndex":1}),
     task("u1-t5","word-order","Questions","Put the words in order.",
          {"words":["How","do","often","you","see","your","cousins","?"],"answer":"How often do you see your cousins?"}),
     task("u1-t6","find-and-click","Find the negatives","Click every negative verb form in the text.",
          {"text":"I don't argue much with my brother. She doesn't like sharing her room. We don't watch the same programmes, but we get on well.","targets":["don't","doesn't"],"mode":"words"}),
   ]),
   ("u1-read","Reading — Sibling rivalry",14,[
     task("u1-t7","multiple-choice","Best summary","Choose the best summary of the text about brothers and sisters.",
          {"options":["A lot of teenagers don't get on well with their siblings, but the relationship is usually good when they are adults.","Some teenagers get on well with siblings and stay that way forever.","Teenagers never argue with their brothers and sisters."],"answerIndex":0}),
     task("u1-t8","true-false","Reading statements","According to the website, people usually stop arguing at around the age of 25.",{"answer":True}),
     task("u1-t9","gap-fill","Give advice","Complete the advice sentence from the text.",
          {"text":"Give your brother or sister some ___ alone when they need it.","blanks":[{"answers":["time","space"]}]}),
   ])]),
 2:("School days",[
   ("u2-vocab","Vocabulary — school subjects & rules",20,[
     task("u2-t1","choose-odd-one-out","School subjects","Tap all words that are NOT school subjects.",
          {"options":[{"text":"geography","isOdd":False},{"text":"rucksack","isOdd":True},{"text":"history","isOdd":False},{"text":"drama","isOdd":False},{"text":"canteen","isOdd":True},{"text":"science","isOdd":False}],"categoryHint":"Subjects vs. school objects/places"}),
     task("u2-t2","matching","School collocations","Match the halves of the phrases.",
          {"pairs":[{"left":"do","right":"homework"},{"left":"hand","right":"in your essay"},{"left":"pay","right":"attention"},{"left":"sit","right":"an exam"}]}),
   ]),
   ("u2-gram","Grammar — have to",22,[
     task("u2-t3","gap-fill","have to / don't have to","Complete with HAVE TO or DON'T HAVE TO.",
          {"text":"1. At the BRIT School students ___ attend all the lessons. 2. You ___ wear a uniform here — it's optional. 3. We ___ be on time. 4. She ___ study on Saturdays.",
           "blanks":[{"answers":["have to"]},{"answers":["don't have to","do not have to"]},{"answers":["have to"]},{"answers":["doesn't have to","does not have to"]}]}),
     task("u2-t4","word-order","Rules","Put the words in order.",
          {"words":["We","must","hand","in","homework","on","Friday"],"answer":"We must hand in homework on Friday"}),
   ]),
   ("u2-exam","Exam Skills — Reading",28,[
     task("u2-t5","true-false","Reading strategy","When checking if a sentence fits a gap, you only need to read the sentence itself.",{"answer":False}),
     task("u2-t6","translate-match","Gap-fit check questions","Match the question to what it checks.",
          {"pairs":[{"left":"Does it make sense?","right":"meaning"},{"left":"Does it fit grammatically?","right":"tense, pronouns, singular/plural"},{"left":"Does it match the topic?","right":"the paragraph subject"}]}),
   ])]),
 3:("Style",[
   ("u3-vocab","Vocabulary — clothes & fashion",32,[
     task("u3-t1","find-and-click","Fabric words","Click all materials in the sentence.",
          {"text":"This jacket is made of leather, with a cotton lining and wool trim.","targets":["leather","cotton","wool"],"mode":"words"}),
     task("u3-t2","multiple-choice","Style check","A person who dresses carefully and stylishly is well ___.",
          {"options":["dressed","worn","put","made"],"answerIndex":0}),
   ]),
   ("u3-gram","Grammar — present continuous",34,[
     task("u3-t3","gap-fill","What's happening now?","Put the verbs in the Present Continuous.",
          {"text":"1. She ___ (wear) a denim jacket today. 2. They ___ (not / follow) the trends. 3. ___ he ___ (try) on those trainers?",
           "blanks":[{"answers":["is wearing"]},{"answers":["aren't following","are not following"]},{"answers":["is"],"hint":"auxiliary"},{"answers":["trying"]}]}),
     task("u3-t4","true-false","Use of the tense","We use the present continuous to talk about future arrangements.",{"answer":True}),
   ])]),
 4:("Food",[
   ("u4-vocab","Vocabulary — food & cooking",40,[
     task("u4-t1","word-search","Kitchen words","Find six hidden food words.",
          {"words":["BREAD","CHEESE","CHICKEN","NOODLES","PEPPER","SALMON"],
           "grid":[list("BREADTX"),list("CHEESESQ"),list("MNOODLESK"),list("PCHICKENL"),list("PEPPERTOW"),list("XSALMONY")],
           "note":"All words are horizontal."}),
     task("u4-t2","choose-odd-one-out","Meals","Tap the odd ones out.",
          {"options":[{"text":"breakfast","isOdd":False},{"text":"fridge","isOdd":True},{"text":"lunch","isOdd":False},{"text":"dinner","isOdd":False},{"text":"pan","isOdd":True}],"categoryHint":"Meals vs. kitchen things"}),
   ]),
   ("u4-gram","Grammar — how much / how many",44,[
     task("u4-t3","gap-fill","much / many / a few / a little","Complete the sentences.",
          {"text":"1. How ___ sugar do we need? 2. There aren't ___ eggs left. 3. Add a ___ milk to the sauce. 4. We have a ___ tomatoes in the fridge.",
           "blanks":[{"answers":["much"]},{"answers":["many"]},{"answers":["little"],"hint":"a ___ (uncountable)"},{"answers":["few"],"hint":"a ___ (countable)"}]}),
     task("u4-t4","multiple-choice","Countable or not?","Which noun is uncountable?",
          {"options":["rice","apple","egg","carrot"],"answerIndex":0}),
   ])]),
 5:("In the city",[
   ("u5-vocab","Vocabulary — places in town",52,[
     task("u5-t1","matching","Places & definitions","Match the place to its definition.",
          {"pairs":[{"left":"library","right":"You can borrow books here"},{"left":"museum","right":"You can see old and interesting objects"},{"left":"pharmacy","right":"You can buy medicine here"},{"left":"town hall","right":"The city government works here"}]}),
     task("u5-t2","find-and-click","Direction verbs","Click all direction verbs in the sentence.",
          {"text":"Go along the street, turn left at the bank, then cross the bridge and continue past the hospital.","targets":["Go","turn","cross","continue"],"mode":"words"}),
   ]),
   ("u5-speaking","Speaking — asking for directions",60,[
     task("u5-t4","gap-fill","Giving directions","Complete the dialogue.",
          {"text":"A: Excuse me, is there a bank ___? B: Yes, it's ___ the supermarket and the chemist. A: How ___ is it? B: About ten minutes on foot.",
           "blanks":[{"answers":["nearby","near here"]},{"answers":["between"]},{"answers":["far"]}]}),
   ])]),
 6:("Going wild",[
   ("u6-vocab","Vocabulary — animals & nature",64,[
     task("u6-t1","choose-odd-one-out","Wild animals","Tap all animals that are NOT wild.",
          {"options":[{"text":"wolf","isOdd":False},{"text":"hamster","isOdd":True},{"text":"eagle","isOdd":False},{"text":"goldfish","isOdd":True},{"text":"snake","isOdd":False}],"categoryHint":"Wild vs. pets"}),
     task("u6-t2","multiple-choice","Strange creatures","An animal people thought didn't exist but later found was considered ___.",
          {"options":["extinct","mythical","robotic","domestic"],"answerIndex":1}),
   ]),
   ("u6-reading","Reading — Stranger than fiction?",68,[
     task("u6-t3","true-false","Comprehension","The text says scientists discovered some 'imaginary' animals were real.",{"answer":True}),
     task("u6-t4","gap-fill","Report the fact","Complete the sentence from the reading.",
          {"text":"For years, people believed the animal was just a ___, but it turned out to be ___.","blanks":[{"answers":["myth","legend","story"]},{"answers":["real"]}]}),
   ])]),
 7:("Digital world",[
   ("u7-vocab","Vocabulary — computing",74,[
     task("u7-t1","find-and-click","Computing verbs","Click all computing verbs in the instructions.",
          {"text":"Connect to Wi-Fi, download the app, enter your password, scan the document, then upload your photo and post a comment.","targets":["Connect","download","enter","scan","upload","post"],"mode":"words"}),
     task("u7-t2","matching","Gadget collocations","Match verb to noun.",
          {"pairs":[{"left":"click","right":"on a button"},{"left":"press","right":"return"},{"left":"get","right":"an error message"},{"left":"check","right":"your emails"}]}),
     task("u7-t3","multiple-choice","Quiz — HTML","The computer language for a lot of pages on the internet is:",
          {"options":["HTTP","HDMI","HTML"],"answerIndex":2}),
     task("u7-t4","multiple-choice","Quiz — GB","A laptop has a 16GB hard drive. What does 'GB' stand for?",
          {"options":["gigaband","gigabyte","gigabar"],"answerIndex":1}),
     task("u7-t5","multiple-choice","Quiz — cookies","When you surf the Web, what do 'cookies' do?",
          {"options":["Protect your computer from viruses.","Make the page the right size for your phone.","Share information about your visit with the website."],"answerIndex":2}),
   ]),
   ("u7-grammar","Grammar — past simple (irregular)",76,[
     task("u7-t6","gap-fill","Irregular past simple","Complete with the past simple of the verbs in brackets.",
          {"text":"1. I ___ (do) all my homework yesterday. 2. My sister ___ (go) to Paris for the weekend. 3. We ___ (buy) a new car last month. 4. She ___ (take) my homework to school, but now I can't find it. 5. We ___ (catch) the train at six o'clock.",
           "blanks":[{"answers":["did"]},{"answers":["went"]},{"answers":["bought"]},{"answers":["took"]},{"answers":["caught"]}]}),
     task("u7-t7","matching","Verb → past form","Match the infinitive to its irregular past form.",
          {"pairs":[{"left":"become","right":"became"},{"left":"begin","right":"began"},{"left":"break","right":"broke"},{"left":"bring","right":"brought"},{"left":"fight","right":"fought"},{"left":"teach","right":"taught"},{"left":"think","right":"thought"},{"left":"read","right":"read"}]}),
     task("u7-t8","find-and-click","Find the mistakes","Click every INCORRECT past form in the sentences.",
          {"text":"I taked a lot of photos yesterday. I did my homework this morning. We speaked to the teacher earlier. I had cereal for breakfast. You comed home late. My grandfather fighted in World War 2.","targets":["taked","speaked","comed","fighted"],"mode":"words"}),
     task("u7-t9","word-order","Word order","Put the words in order.",
          {"words":["George","built","himself","an","aeroplane"],"answer":"George built himself an aeroplane"}),
     task("u7-t10","translate-match","Look out! -ought / -aught","Match the verb to its past form ending in -ought/-aught.",
          {"pairs":[{"left":"bring","right":"brought"},{"left":"buy","right":"bought"},{"left":"teach","right":"taught"},{"left":"think","right":"thought"},{"left":"catch","right":"caught"},{"left":"fight","right":"fought"}]}),
   ]),
   ("u7-reading","Reading — Make your dreams a reality",76,[
     task("u7-t11","multiple-choice","George Mel — why did he leave school?","Why did George have to give up school?",
          {"options":["He moved to another country.","His family had no money.","He failed his exams."],"answerIndex":1}),
     task("u7-t12","true-false","George Mel","A company saw George's video and offered him a job.",{"answer":True}),
     task("u7-t13","gap-fill","Max's email","Complete the email with the past simple forms.",
          {"text":"Hi Milly! My weekend ___ (be) great. On Friday I ___ (do) all my homework, so I ___ (can) relax. On Saturday a friend ___ (come) to see me and ___ (bring) a few DVDs, so we ___ (stay) at home and ___ (watch) them.",
           "blanks":[{"answers":["was"]},{"answers":["did"]},{"answers":["could"]},{"answers":["came"]},{"answers":["brought"]},{"answers":["stayed"]},{"answers":["watched"]}]}),
   ]),
   ("u7-listening","Listening — conversations",77,[
     task("u7-t14","multiple-choice","Listening — tablet quiz","Listen to the conversation. What is the boy doing? [Audio to be added manually] 🎧",
          {"options":["connecting his tablet to Wi-Fi","deleting contacts","printing a document"],"answerIndex":0},
          media_audio=("u7-track-1.mp3","Unit 7 · listening")),
     task("u7-t15","translate-match","Key phrases","Match the halves of the useful phrases.",
          {"pairs":[{"left":"get","right":"your emails"},{"left":"click","right":"on a button"},{"left":"press","right":"return"},{"left":"visit","right":"a web page"}]}),
   ])]),
 8:("Be active",[
   ("u8-vocab","Vocabulary — sports & free time",82,[
     task("u8-t1","choose-odd-one-out","Sports verbs","Tap the phrases that do NOT go with 'play'.",
          {"options":[{"text":"play football","isOdd":False},{"text":"play chess","isOdd":False},{"text":"play the bike","isOdd":True},{"text":"play tennis","isOdd":False},{"text":"play skateboarding","isOdd":True}],"categoryHint":"play + ball games / games"}),
     task("u8-t2","matching","Do / go / play","Match the activity to its verb.",
          {"pairs":[{"left":"yoga","right":"do"},{"left":"swimming","right":"go"},{"left":"volleyball","right":"play"},{"left":"karate","right":"do"},{"left":"jogging","right":"go"}]}),
   ]),
   ("u8-grammar","Grammar — was / were",84,[
     task("u8-t3","gap-fill","was / were","Complete the sentences.",
          {"text":"1. I ___ at the gym yesterday evening. 2. We ___ tired after the match. 3. She ___ in a great mood! 4. The coaches ___ proud of the team.",
           "blanks":[{"answers":["was"]},{"answers":["were"]},{"answers":["was"]},{"answers":["were"]}]}),
   ])]),
 9:("Home sweet home",[
   ("u9-vocab","Vocabulary — house & furniture",90,[
     task("u9-t1","matching","Rooms & things","Match the room to what you usually find there.",
          {"pairs":[{"left":"kitchen","right":"fridge and cooker"},{"left":"bathroom","right":"shower and mirror"},{"left":"attic","right":"old boxes upstairs"},{"left":"garage","right":"car and tools"}]}),
     task("u9-t2","find-and-click","Prepositions of place","Click all position prepositions in the description.",
          {"text":"The lamp is next to the sofa, the rug is under the table, and the pictures are above the shelf.","targets":["next","under","above"],"mode":"words"}),
   ]),
   ("u9-revision","Revision — mixed",96,[
     task("u9-t3","word-search","Revision words","Find five course words.",
          {"words":["FAMILY","SCHOOL","DIGITAL","ANIMAL","KITCHEN"],
           "grid":[list("FAMILYAB"),list("XSCHOOLC"),list("DDIGITALD"),list("EANIMALF"),list("GKITCHENH")],
           "note":"All words are horizontal."}),
     task("u9-t4","true-false","Plural rule","Most nouns form the plural by adding -s.",{"answer":True}),
   ])]),
}

for num,(uname,lessons) in unit_meta.items():
    entry={"id":"u%d"%num,"title":"Unit %d — %s"%(num,uname),"lessons":[]}
    for lid,ltitle,lpage,tasks in lessons:
        entry["lessons"].append({"id":lid,"title":ltitle,"page":lpage,"tasks":tasks})
    sb_units.append(entry)
sb={"units":sb_units}

wb_units=[{"id":"starter","title":"Starter Unit","lessons":[
 {"id":"ws-gram","title":"Grammar — can","page":6,"tasks":[
  task("ws-t1","gap-fill","can / can't","Complete the sentences.",
       {"text":"1. ___ you ride a horse? 2. No, I ___. 3. She ___ speak French very well. 4. We ___ use phones in class — it's forbidden!",
        "blanks":[{"answers":["Can"]},{"answers":["can't","cannot"]},{"answers":["can"]},{"answers":["can't"]}]}),
 ]}]}]

wb_meta={
 1:("Family and friends",[
   ("wu1-word","Word Skills — singular & plural nouns",10,[
     task("wu1-t1","gap-fill","Plural endings","Complete the spelling rules.",
          {"text":"1. To make the plural of most nouns we add ___. 2. If the noun ends in -s, -sh, -ch, -z or -x, we add ___. 3. If it ends in consonant + -y, change -y to ___. 4. If it ends in -f or -fe, we often change it to ___.",
           "blanks":[{"answers":["s","-s"]},{"answers":["es","-es"]},{"answers":["ies","-ies"]},{"answers":["ves","-ves"]}]}),
     task("wu1-t2","multiple-choice","Irregular plural","The plural of 'knife' is:",
          {"options":["knifes","knives","knivez"],"answerIndex":1}),
     task("wu1-t3","find-and-click","Uncountable nouns","Click all the uncountable nouns in the sentence.",
          {"text":"We always buy bread, cheese and tomatoes, and drink milk with dinner.","targets":["bread","cheese","milk"],"mode":"words"}),
   ]),
   ("wu1-gram","Grammar — present simple",12,[
     task("wu1-t4","word-order","Negative sentences","Put the words in order.",
          {"words":["He","doesn't","like","reality","TV","shows"],"answer":"He doesn't like reality TV shows"}),
     task("wu1-t5","gap-fill","Adverbs of frequency","Put the adverb in the correct place.",
          {"text":"1. I am ___ late for school (always). 2. She eats ___ meat (never).",
           "blanks":[{"answers":["always"]},{"answers":["never"]}]}),
   ])]),
 2:("School days",[
   ("wu2-vocab","Vocabulary — school",16,[
     task("wu2-t1","choose-odd-one-out","Classroom objects","Tap the odd ones out.",
          {"options":[{"text":"ruler","isOdd":False},{"text":"break","isOdd":True},{"text":"rubber","isOdd":False},{"text":"sharpener","isOdd":False},{"text":"PE","isOdd":True}],"categoryHint":"Objects vs. other words"}),
   ]),
   ("wu2-gram","Grammar — have to",18,[
     task("wu2-t2","gap-fill","have to","Complete the school rules.",
          {"text":"1. We ___ wear a uniform. 2. Students ___ arrive on time. 3. I ___ do homework every day. 4. She ___ get up early on Sundays (it's not necessary).",
           "blanks":[{"answers":["have to"]},{"answers":["have to"]},{"answers":["have to"]},{"answers":["doesn't have to","does not have to"]}]}),
   ])]),
 4:("Food",[
   ("wu4-gram","Grammar — much / many",36,[
     task("wu4-t1","multiple-choice","How ___ apples?","___ apples do we need for the pie?",
          {"options":["How much","How many","How many of"],"answerIndex":1}),
     task("wu4-t2","gap-fill","a few / a little","Complete.",
          {"text":"1. There is ___ water in the bottle. 2. We have ___ vegetables left. 3. How ___ sugar do you take in your tea?",
           "blanks":[{"answers":["a little"]},{"answers":["a few"]},{"answers":["much"]}]}),
   ])]),
 5:("In the city",[
   ("wu5-vocab","Vocabulary — town",42,[
     task("wu5-t1","matching","Where do you buy it?","Match the thing to the shop.",
          {"pairs":[{"left":"medicine","right":"pharmacy"},{"left":"bread","right":"bakery"},{"left":"novel","right":"bookshop"},{"left":"steak","right":"butcher's"}]}),
   ])]),
 6:("Going wild",[
   ("wu6-read","Reading — animals",52,[
     task("wu6-t1","true-false","Animal facts","The giant panda lives mainly on bamboo.",{"answer":True}),
     task("wu6-t2","word-search","Endangered animals","Find four animals.",
          {"words":["PANDA","TIGER","ORANGUTAN","WHALE"],
           "grid":[list("XPANDAYZ"),list("TTIGERWQ"),list("ORANGUTANR"),list("ZWHALEVK")],
           "note":"All words are horizontal."}),
   ])]),
 7:("Digital world",[
   ("wu7-vocab","Vocabulary — computing",68,[
     task("wu7-t1","word-search","Computing nouns","Find five computing words from the workbook wordsearch.",
          {"words":["CAMERA","DRIVE","KEYBOARD","MONITOR","SCREEN"],
           "grid":[list("CAMERAXXKL"),list("MDRIVEQQAZ"),list("KEYBOARDWW"),list("ZMONITORPL"),list("SSCREENHJ")],
           "note":"All words are horizontal."}),
     task("wu7-t2","word-order","Present continuous sentences","Put the words in order.",
          {"words":["They","are","scanning","an","important","document"],"answer":"They are scanning an important document"}),
     task("wu7-t3","gap-fill","Present continuous","Complete the sentences.",
          {"text":"1. He ___ (upload) some photos now. 2. She ___ (post) a comment on Facebook. 3. I ___ (not / delete) my files. 4. ___ you ___ (surf) the Web?",
           "blanks":[{"answers":["is uploading"]},{"answers":["is posting"]},{"answers":["am not deleting"]},{"answers":["Are"],"hint":"auxiliary"},{"answers":["surfing"]}]}),
     task("wu7-t4","multiple-choice","Listening cloze","'You just need to ___ the link.' Choose the correct verb. [Audio to be added manually] 🎧",
          {"options":["click","delete","print"],"answerIndex":0},
          media_audio=("wb-u7-track.mp3","Workbook Unit 7 · dialogues")),
   ]),
   ("wu7-gram","Grammar — past simple irregular",70,[
     task("wu7-t5","gap-fill","Sam Kodo text","Complete with the past simple of the verbs in brackets.",
          {"text":"Sam Kodo from Togo ___ (become) an inventor when he was young. When he ___ (be) seven, he ___ (build) his own robot. The robot ___ (can) move around a room. Sam often ___ (go) with his father to work and ___ (read) books in the library. His favourite books ___ (be) about electronics. He ___ (begin) to make things from broken TVs.",
           "blanks":[{"answers":["became"]},{"answers":["was"]},{"answers":["built"]},{"answers":["could"]},{"answers":["went"]},{"answers":["read"]},{"answers":["were"]},{"answers":["began"]}]}),
     task("wu7-t6","find-and-click","Incorrect past forms","Click every INCORRECT past simple form.",
          {"text":"I taked a lot of photos. We speaked to the teacher. You comed home late. My grandfather fighted in the war. I had cereal.","targets":["taked","speaked","comed","fighted"],"mode":"words"}),
     task("wu7-t7","matching","Irregular verbs chart","Match the verb to its past simple.",
          {"pairs":[{"left":"draw","right":"drew"},{"left":"fall","right":"fell"},{"left":"find","right":"found"},{"left":"see","right":"saw"},{"left":"think","right":"thought"},{"left":"buy","right":"bought"},{"left":"catch","right":"caught"},{"left":"dream","right":"dreamt"}]}),
     task("wu7-t8","word-order","Make a sentence","Put the words in order.",
          {"words":["We","saw","an","interesting","film","last","night"],"answer":"We saw an interesting film last night"}),
   ])]),
 8:("Be active",[
   ("wu8-gram","Grammar — past simple",80,[
     task("wu8-t1","gap-fill","Regular or irregular?","Complete with the past simple.",
          {"text":"1. I ___ (travel) around Japan last summer. 2. My brother ___ (bring) home a cat. 3. The lesson ___ (finish) an hour ago. 4. My parents ___ (teach) abroad ten years ago.",
           "blanks":[{"answers":["travelled","traveled"]},{"answers":["brought"]},{"answers":["finished"]},{"answers":["taught"]}]}),
   ])]),
 9:("Home sweet home",[
   ("wu9-vocab","Vocabulary — home",90,[
     task("wu9-t1","matching","Parts of a house","Match the word to its description.",
          {"pairs":[{"left":"ceiling","right":"at the top of a room"},{"left":"floor","right":"you walk on it"},{"left":"gate","right":"at the edge of a garden"},{"left":"chimney","right":"smoke goes out of it"}]}),
   ])]),
}

for num,(uname,lessons) in wb_meta.items():
    entry={"id":"u%d"%num,"title":"Unit %d — %s"%(num,uname),"lessons":[]}
    for lid,ltitle,lpage,tasks in lessons:
        entry["lessons"].append({"id":lid,"title":ltitle,"page":lpage,"tasks":tasks})
    wb_units.append(entry)
wb={"units":wb_units}

manifest={
 "id":"solutions-elementary",
 "title":"Solutions Elementary (3rd edition)",
 "subtitle":"Student's Book + Workbook",
 "level":"CEFR A1–A2 (Elementary)",
 "publisher":"Pearson — converted from SB/WB for IntExeBook",
 "description":"Interactive versions of Starter + Units 1–9 exercises. Listening tasks carry audio placeholders (assets/*.mp3) — drop the real tracks into textbooks/solutions-elementary/assets/ and they start playing automatically.",
 "color":"#e11d48",
 "icon":"🎓",
 "student":"Student's Book",
 "workbook":"Workbook"
}

json.dump(manifest,open(OUT+"/manifest.json","w"),indent=2,ensure_ascii=False)
json.dump(sb,open(OUT+"/student.json","w"),indent=2,ensure_ascii=False)
json.dump(wb,open(OUT+"/workbook.json","w"),indent=2,ensure_ascii=False)
nt=lambda b:sum(len(l["tasks"]) for u in b["units"] for l in u["lessons"])
print("SB units:",len(sb["units"]),"tasks:",nt(sb))
print("WB units:",len(wb["units"]),"tasks:",nt(wb))
open(OUT+"/assets/README.txt","w").write(
"Put the real audio files here with these exact names:\n"+
"starter-track-1.mp3, starter-track-2.mp3, u7-track-1.mp3, wb-u7-track.mp3\n"+
"(mp3/ogg/m4a accepted — adjust media.src in student.json/workbook.json if you use another extension)\n")
