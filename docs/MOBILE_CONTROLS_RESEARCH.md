# Mobile controls: deliberate tool use with two thumbs

Research and implementation brief, 14 September 2026. The user's latest instruction is authoritative: **no automatic chiselling**. The supplied mobile-game and AI-overview screenshots are visual references, not proof that every suggested feature is appropriate here.

## Sources and decisions

- [MDN: multi-touch interaction](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Multi-touch_interaction) describes keeping independent state for concurrent pointers. Movement, view dragging and explicit tool use need separate pointer owners. Lifting one finger must not release another finger's tool.
- [MDN: setPointerCapture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture) routes subsequent events to the captured element until release. Capture keeps a thumb gesture alive beyond a small control's visual boundary; pointer cancellation and lost capture still require cleanup.
- [W3C Pointer Events](https://www.w3.org/TR/pointerevents/) defines browser gesture handling through `touch-action`. Game gesture surfaces use `touch-action: none`; ordinary menus retain appropriate scrolling. Mouse handlers must not consume touch releases.
- [Unity Input System: on-screen stick behaviour](https://docs.unity.cn/Packages/com.unity.inputsystem%401.8/api/UnityEngine.InputSystem.OnScreen.OnScreenStick.Behaviour.html) documents a dynamic origin anchored at the initial press. A floating left stick avoids requiring the thumb to land at one exact centre. This is a pattern reference, not a Unity dependency.
- [Activision: Call of Duty Mobile controls](https://blog.activision.com/call-of-duty/2019-10/Getting-a-Grip-on-the-Call-of-Duty-Mobile-Controls) distinguishes manual fire controls from automatic fire and documents configurable controls. We use deliberate hold-to-work, with simultaneous camera adjustment, rather than activating a tool from camera motion or wall proximity.
- [W3C: enhanced target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html) recommends 44 by 44 CSS pixel targets for this criterion. Quick controls use at least that footprint, icons plus readable current values, and clear spacing.

## Game-specific interaction contract

1. Left lower play area: touch establishes the movement origin; drag moves the player. Movement remains independent of tool use.
2. Right circular USE control: deliberate press starts the selected action immediately, including at its centre. Hold for hammer, spray and water; hold then release for the trowel. Drag while holding adjusts aim. A stick mode supports continued turning without repeated swipes; a direct-drag option supports fine placement.
3. Ordinary play-surface drag: look only. It must never queue tool use on movement or release, even through legacy automatic-control settings.
4. Release the USE finger to stop. Cancellation, settings, tool changes, focus loss and device rotation must clear owned mobile actions without casting cancelled mortar or leaving stale movement.
5. Contextual icon controls expose blade width, tilt, side and hammer speed during hammer use. Other tools expose their own relevant controls. The central work area stays clear, and configuration is not buried in Settings.
6. Show whether the action is held and whether the chisel can actually work. A visible tool near the wall is not sufficient evidence of a solid, reachable contact.

## Validation boundaries

Native browser touch injection in isolated mobile emulation verifies simultaneous pointer sequences and real game effects. Desktop and mobile viewport screenshots verify layout. Pointer Lock is blocked before navigation in every automated context. Chrome emulation cannot establish physical iPhone/Safari performance or thumb comfort; those require a physical device.
