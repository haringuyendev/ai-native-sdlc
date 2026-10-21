# Writing good tests

Read this file whenever you add or edit a test, bring in a mock or fake, or are about to give a class a helper or teardown method that only tests will call.

## What every test owes you

1. **A named break.** You can say which production change turns it red.
2. **Contact with the real code.** It fails because the real thing misbehaves, not because a stand-in did.

Writing the test first gets you both almost for free. Seeing it go red against real code proves it can fail. A double only comes in once the real dependency proves slow, or reaches outside the process.

## Step 1: before the body, answer one question

Which edit to production code would make this test fail, and would that edit be a bug or a deliberate choice?

| Your answer | What to do |
|---|---|
| A bug: a wrong branch, a missing side effect, a wrong argument, a boundary case, a broken contract | Write the test. |
| Nothing comes to mind | Rebuild the test around something observable the code does. |
| "Someone edited the source text" | Execute the artifact and assert on what it produces. |
| Only deliberate choices would trip it | You have a change detector. Aim it at whatever outcome hinges on that choice. |

## Step 2: apply the rules

Each rule comes with a concrete case. The rules are grouped by what they protect.

### Where the expected value comes from

| Rule | Case |
|---|---|
| Work out expected values by hand. Use literals, hand-checked fixtures, or a case table with a literal `want` column. Never take a value computed by the code under test or by its helpers. | `assert.equal(toCsvRow(['a', 'b,c']), 'a,"b,c"')`. It is never `const want = toCsvRow([...])` followed by comparing the function's output with itself. |
| Do not assert on a choice; assert on what the choice causes. If only a deliberate edit (a constant's value, the wording of a message, the layout of private fields) can trip a test, it fires on every redesign and stays quiet through bugs. | Not `assert.equal(PAGE_SIZE, 20)`, but "page 1 holds 20 rows and page 2 opens at row 21". |

### What is in scope

| Rule | Case |
|---|---|
| Test what the code does, never what the file says. Run a script on controlled input and check its stdout, the files it writes, or its exit code. | A migration script is tested by running it against a scratch database and counting the rows it moved, not by grepping it for `ALTER TABLE`. |
| Documents follow the same rule. Instructions for agents are proven by how the agent reading them acts, through evals and trigger prompts. Prose meant for humans gets no test. | A skill's wording is proven by an eval that checks the skill fires. A README gets nothing. |
| Test the contract at your own edges: routes your code registers, SQL it generates, payloads it sends out. How the library works internally is its maintainers' job. | Checking that the HTTP framework parses a JSON body before your handler sees it is the framework's test. Check instead that your handler answers 422 to a body missing `email`. |
| When upstream behavior caught you out, pin it with one narrow characterization test whose name states the assumption. | `relies on: date-lib treats '2026-02-30' as invalid` |
| Inside your own code, a constructor, getter, constant or pass-through function gets a test of its own only if it validates, normalizes, fills in a default, derives a value, enforces a rule, or has a side effect. Otherwise, assert on the first result a consumer can see that depends on it. | A plain `get name()` gets no test. A setter that trims and lowercases does. |

### Doubles: mocks, stubs, fakes

| Rule | Case |
|---|---|
| Never assert on the double itself. Such an assertion passes while the stub exists and fails when it is gone, so it tells you nothing. Either remove the mock or remove the assertion. Your human partner will catch this by asking whether the test checks the code or only the mock. | Not `getByTestId('avatar-stub')`, but `getByText('Signed in as Mai')` from the real header. |
| Before you replace a method, list everything it actually does. Fake only the slow or external level underneath, and keep real every effect the test relies on. If you are unsure, run the test once against the genuine implementation and observe which effects it truly needs. | Stubbing all of `saveOrder` also skips the audit row the test reads later. Fake `gateway.charge` instead, and leave `saveOrder` real. |
| Make doubles strict. When arguments, call counts or call order are part of the contract, assert on them. Give success, error and malformed input each their own fixture or spy, so the wrong path cannot satisfy the assertion by accident. | A refund spy asserts it was called once with `{ amount: 1200, currency: 'VND' }`, not just that it was called. |
| A fake response has the same complete shape as the real one, with every documented field, not just the fields this test reads. Otherwise downstream code reads a missing field and the integration breaks while the unit test stays green. | A fake user record includes `locale` and `deletedAt` even though this test only looks at `id`. |
| Switch to real components when the mocks start to dominate. The signs: arranging doubles outweighs the logic under test, the double lacks methods the real object has, or tests break whenever the double changes. Your human partner will ask whether this test needs a mock at all. | Replace a ten-line repository stub with an in-memory SQLite instance. |

### Production code stays production code

| Rule | Case |
|---|---|
| Teardown, reset or inspection code needed by tests alone belongs in a test utility. Ask two questions: is the method called only from tests, and does this class really own the resource's lifecycle? If the first answer is yes, or the second is no, move it to a test utility. | `resetCacheForTests()` goes in `tests/helpers/cache.mjs`, not on `class Cache`. |
| Tests ship with the behavior. The TDD loop (failing test, minimal code, refactor) is what "complete" means. Write the tests the behavior needs and nothing more. Trivial code and human prose get none, and a test written only to satisfy the process is upkeep you pay for forever. | A pure rename needs no new test. A new branch for refunds does. |

## Step 3: the mutation drill

When you think the work is done, sabotage the production code in your head, one edit at a time. For each edit, a specific test should go red. The examples use `applyDiscount(cart, code)`.

| Imagined sabotage | The test that ought to catch it |
|---|---|
| A guard is removed, so zero, nil, empty, malformed or unauthorized input slips through | A test that feeds `code = ''`, an expired code, or a code from another account, and expects a rejection |
| The function returns an empty or default value | A test that expects a specific discounted total, not merely a number |
| A state change or side effect is skipped | A test that checks the code is marked as used after the discount applies |
| The wrong branch handler runs | Separate tests for a percentage code and a fixed-amount code, each with a literal total |
| A constant or argument is off | A test at the exact threshold where the discount starts |

If an edit goes unnoticed, either that behavior has no protection or the test meant to cover it is a tautology.

## Step 4: smells, and the rule each one breaks

| You notice | Rule broken |
|---|---|
| Expected values are hidden in loops, builders or helpers | Work out expected values by hand |
| Setup and assertion share one object, so they are equal by construction | Work out expected values by hand |
| Every intentional change breaks it, and accidental breakage never does | Assert on what a choice causes |
| It can only fail by crashing, panicking or losing a selector | The named break (step 1) |
| It exists for coverage and checks no outcome or side effect | The named break; tests ship with the behavior |
| Source text gets grepped, or a deleted symbol is checked to still be gone | Test what the code does, not what the file says |
| It would still make sense if only the framework were left | Test the contract at your own edges |
| An assertion targets a `*-stub` or `*-mock` ID, or breaks when the double is removed | Never assert on the double |
| Arranging mocks takes up most of the lines, or nobody can say why a mock is there | Switch to real components |
| Something was mocked "just to be safe" | Fake only the slow or external level |
| A production method has no callers outside tests | Production code stays production code |
