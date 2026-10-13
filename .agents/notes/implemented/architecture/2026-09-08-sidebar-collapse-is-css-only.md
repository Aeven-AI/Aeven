# Agent Note: The sidebar collapse is CSS only

Status: implemented

English | [中文](2026-09-08-sidebar-collapse-is-css-only.zh.md)

## Problem

The sidebar collapse has been rebuilt from JavaScript into CSS five times. Each rebuild removes the measuring, and each following change puts some of it back — a column solver, a `ResizeObserver`, a width published from React onto an ancestor — because nothing in the repository states the rule or fails when it is broken. The regression is invisible to every existing gate: the unit lane stubs `ResizeObserver` and `matchMedia`, the browser lane asserts ARIA and geometry rather than what runs during an animation, and the slide still *works* when it is slow. Only a person watching the sidebar move can see it, which is why it keeps shipping.

The Aeven client the harness is modelled on does the whole thing in one declaration:

```css
.sidebar { transition: width 0.4s cubic-bezier(0.23, 1, 0.32, 1); }
```

A class changes, the column animates, and no JavaScript runs. That is the target, and the harness is expected to match it exactly.

## Decision

**While the sidebar animates, no JavaScript runs.** The collapse is a class change on the sidebar column and a CSS `width` transition. Nothing measures a box, publishes a width, schedules a frame, or answers a resize for the duration of the slide.

Three rules follow, and each is a rule about code that may not exist rather than code that must:

**No element that changes width with the sidebar may be observed.** `ResizeObserver` has no axis filter: an observer on a box the slide resizes is invoked once per animation frame no matter what its callback then decides to skip. Ignoring width inside the callback is not compliance — the callback firing is the violation, because it is what the next change grows work inside. An observer that needs a height observes a box whose width the slide does not change.

**No React render is triggered by the toggle.** The collapsed state reaches the DOM as a class or data attribute. A store update that re-renders the frame re-renders the conversation beneath it, which is a synchronous transcript render standing between the click and the first animated frame.

**No width is published from JavaScript.** The column width is read in CSS by the elements that need it (`100cqi` on the frame's centre column). Writing an inherited custom property on an ancestor of the transcript invalidates style for every element under it, once per frame.

The narrow-viewport breakpoint stays in `matchMedia`, which is not a measurement: it delivers one event when a boundary is crossed and is silent while a column animates.

## Measured state at the time of writing

The slide is smooth at 8ms median frames, but two violations stand:

A single collapse invokes `ResizeObserver` callbacks 135 times over 376ms — 90 on `composerSeat`, 45 on `scrollBody`, both observed by `ConversationRoot`'s seat observer. The observed seat's height is constant at 165px throughout while its width moves 1440→1695. The callbacks do no layout, because both that observer and `ChatView`'s carry a height-only guard that returns before reading geometry, and the measured style writes during a slide are zero. The guard is holding and the observers are still running: the rule above is written against the invocation, not the work inside it.

The toggle click costs one 56ms long task before the transition's first frame, so the animation begins with a dropped frame and then runs clean.

## Enforcement

A note is what already failed here, four times. This rule needs a test that fails when a `ResizeObserver` is invoked during a collapse: install a counting wrapper before boot, toggle the sidebar, drive the transition to completion, and assert zero invocations. The browser lane is where that belongs, because the violation only exists in a real layout engine — jsdom implements neither `ResizeObserver` nor a transition, which is exactly why every existing test is blind to it.

## Alternatives considered

**Guard the callback instead of the observation.** This is what the code does now, and the measurement above is what it buys: 135 invocations that correctly do nothing. It is not stable, because the guard's correctness is re-argued by every change that wants one more fact out of the callback, and the cost of getting it wrong is invisible until someone watches the animation.

**Keep the column solver and make it cheaper.** Rejected repeatedly. Every JavaScript answer to a resize runs at animation cadence, so the cost is per frame and grows with transcript size; the CSS engine already animates a width without help.

**Publish the column width as a custom property for the conversation to read.** Rejected because the property must live on an ancestor of the transcript, so each write invalidates style for the whole subtree — the specific mistake the `100cqi` container query replaced.

## Consequences

Anything that wants a live measurement of a box the sidebar resizes cannot have one, and must either derive it in CSS or accept a value that updates when the slide ends. That is the cost, and it is the point: the constraint is what keeps the animation at the CSS engine's frame budget instead of the transcript's.

The composer seat is currently observed and does change width with the slide, so satisfying the first rule means either moving the seat into a width-stable box or finding its height without observing it. Until that lands, this note describes a rule the code does not yet meet, and the enforcement test above is what turns the gap into a failure rather than a memory.
