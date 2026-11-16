---
name: letter-constraints
description: Writing under a letter or character rule — text without a given letter (a lipogram), every word starting with one letter, an exact letter or character count, only certain letters, a pangram, an acrostic. Use whenever a request forbids, requires or counts specific letters or characters, in any language.
user-invocable: false
---

# Letter constraints

You read text as tokens, not letters, so you cannot reliably see whether a word contains a letter. Checking letter by letter in your reasoning is slow and still misses violations. Let code do the checking.

1. **Pin the rule.** Name the exact characters involved. Unless the person says otherwise, the rule covers upper and lower case and accented forms of the letter (`e` also covers `E`, `é`, `è`, `ê`, `ë`), and it covers your whole reply, not only the requested piece.
2. **Draft once.** Write the whole text in one go, choosing words that obviously follow the rule.
3. **Check with a script.** Run a short Python, Node or shell script over the exact reply you will send that prints every word breaking the rule, or the counts the rule asks for.
4. **Fix only what failed.** Replace the flagged words, then run the script again. Repeat until it reports nothing.
5. **Deliver exactly the checked reply.** Add no preamble, heading, word count or note about the check, since those break the rule too.

Without a way to run code, write the draft with plain, short words, check each word once, and give the result without looping.
