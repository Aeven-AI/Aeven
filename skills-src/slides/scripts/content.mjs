/**
 * What each template's deck is made of: the sections in order. A section
 * becomes two slides (a claim and its evidence), so seven sections plus the
 * cover, the agenda and the close make a twenty-slide deck.
 */
export const SECTIONS = {
  'annual-report-editorial': ['Letter from the CEO', 'The year in numbers', 'What we made', 'Where we grew', 'What went wrong', 'Sustainability', 'The year ahead'],
  'brand-story-editorial': ['Where it started', 'The name', 'What we believe', 'The look', 'The voice', 'The people', 'What comes next'],
  'field-notes-editorial': ['Why we look', 'Field one', 'Field two', 'Field three', 'What we learned', 'Open questions', 'Notes for next year'],
  'the-long-view-editorial': ['The next decade', 'Three shifts', 'What we stop', 'What we start', 'The first year', 'The risk', 'The invitation'],
  'issue-one-editorial': ['The idea', 'Who it is for', 'The first issue', 'The voice', 'The team', 'The model', 'The ask'],

  'startup-pitch-swiss': ['The problem', 'The product', 'How it works', 'Traction', 'The market', 'Why us', 'The ask'],
  'product-strategy-swiss': ['Where we are', 'The bet', 'The user', 'The plan', 'What we cut', 'The numbers', 'The decision'],
  'design-review-swiss': ['What we saw', 'Option A', 'Option B', 'Option C', 'The trade-off', 'The recommendation', 'Next step'],
  'talk-no12-swiss': ['The claim', 'How we got here', 'Three examples', 'The counter-argument', 'What it means', 'What to do Monday', 'Questions'],
  'offsite-swiss': ['Why we are here', 'Day one', 'Day two', 'The rules', 'The teams', 'The output', 'Who owns what'],

  'seed-round-darktech': ['What we built', 'Traction', 'Unit economics', 'The market', 'Competition', 'The team', 'The round'],
  'ai-launch-darktech': ['What shipped', 'How it works', 'Benchmarks', 'The API', 'Pricing', 'Limits', 'What is next'],
  'roadmap-2027-darktech': ['The platform today', 'Quarter one', 'Quarter two', 'Quarter three', 'Quarter four', 'What we skip', 'How we measure'],
  'threat-model-darktech': ['The surface', 'The first risk', 'The second risk', 'What we fixed', 'What remains', 'Monitoring', 'The plan'],
  'dev-day-darktech': ['The API', 'The SDK', 'Rate limits', 'Pricing', 'What is new', 'Migration', 'The roadmap'],

  'create-more-gradient': ['The fund', 'Who it is for', 'What you get', 'The terms', 'The tracks', 'How to apply', 'The first cohort'],
  'campaign-26-gradient': ['The idea', 'The audience', 'The message', 'The channels', 'The calendar', 'The budget', 'The numbers'],
  'sound-pitch-gradient': ['The label', 'The roster', 'The sound', 'The reach', 'The model', 'The catalogue', 'The deal'],
  'drop-day-gradient': ['The product', 'The hook', 'The creators', 'The schedule', 'The assets', 'The launch', 'The follow-up'],
  'feel-good-gradient': ['The feeling', 'The people', 'The palette', 'The product', 'The places', 'The campaign', 'The promise'],

  'studio-proposal-paper': ['The brief', 'What we heard', 'The approach', 'The scope', 'The timeline', 'The fee', 'The team'],
  'printed-matter-paper': ['The press kit', 'The paper', 'The ink', 'The formats', 'The runs', 'The price', 'The deadlines'],
  'tasting-menu-paper': ['The room', 'The menu', 'Course one', 'Course two', 'The wine', 'The price', 'The booking'],
  'invitation-paper': ['The occasion', 'The place', 'The programme', 'The menu', 'The dress', 'The gifts', 'The RSVP'],
  'artist-book-paper': ['The works', 'The process', 'The materials', 'The essays', 'The sequence', 'The edition', 'The studio'],

  'roast-retro': ['The beans', 'The roast', 'The cup', 'The farm', 'The price', 'The shop', 'The plan'],
  'the-route-retro': ['The idea', 'Day one', 'Day two', 'Day three', 'The stays', 'The food', 'The map'],
  'side-a-retro': ['The shop', 'The stock', 'The listening room', 'The events', 'The membership', 'The numbers', 'The opening'],
  'almanac-retro': ['The year', 'The weather', 'The harvest', 'The market', 'The people', 'The numbers', 'The next year'],
  'night-shift-retro': ['The room', 'The light', 'The menu', 'The drinks', 'The music', 'The hours', 'The team'],

  'qbr-report': ['The quarter', 'Revenue', 'Costs', 'Customers', 'What worked', 'What did not', 'Next quarter'],
  'market-map-report': ['The market', 'The segments', 'Who buys', 'Who does not', 'The pricing', 'The competitors', 'The opening'],
  'findings-report': ['How we asked', 'Who answered', 'Finding one', 'Finding two', 'Finding three', 'What it means', 'What we do'],
  'growth-report': ['The month', 'The channels', 'The funnel', 'Retention', 'The experiment', 'The cost', 'The plan'],
  'voc-report': ['The sample', 'What they love', 'What they hate', 'The pricing view', 'Churn reasons', 'The quotes', 'The actions'],

  'places-photo': ['The route', 'Frame one', 'Frame two', 'Frame three', 'The light', 'The people', 'The next trip'],
  'listing-photo': ['The address', 'The living room', 'The kitchen', 'The bedroom', 'The building', 'The neighbourhood', 'The price'],
  'structures-photo': ['The practice', 'Project one', 'Project two', 'Project three', 'The material', 'The detail', 'The site'],
  'table-photo': ['The room', 'The kitchen', 'The menu', 'The wine', 'The service', 'The numbers', 'The team'],
  'lookbook-photo': ['The season', 'Look one', 'Look two', 'Look three', 'The fabric', 'The palette', 'The credits'],

  'workshop-playful': ['The plan', 'Warm-up', 'Make one', 'Make two', 'The break', 'Show and tell', 'Take home'],
  'meetup-playful': ['Tonight', 'The talks', 'The people', 'The rules', 'The food', 'The next one', 'Say hi'],
  'hello-playful': ['The first screen', 'What you can do', 'Your first task', 'The shortcuts', 'The settings', 'The help', 'The welcome'],
  'play-playful': ['The game', 'The hook', 'The players', 'The art', 'The monetisation', 'The team', 'The demo'],
  'project-playful': ['The question', 'What I found', 'My method', 'The result', 'What surprised me', "What I'd change", 'Thank you'],

  'board-corporate': ['The quarter', 'The numbers', 'The risk', 'The decision', 'The ask', 'The timeline', 'The owners'],
  'proposal-corporate': ['The situation', 'The objective', 'The approach', 'The scope', 'The team', 'The price', 'The next step'],
  'case-study-corporate': ['The client', 'The problem', 'What we did', 'The result', 'The proof', 'The lesson', 'The offer'],
  'partnership-corporate': ['The fit', 'What we bring', 'What you bring', 'The model', 'The first year', 'The investment', 'The terms'],
  'update-corporate': ['The month', 'The numbers', 'The wins', 'The misses', 'The runway', 'The asks', 'The thanks'],
}
