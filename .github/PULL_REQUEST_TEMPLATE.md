## What this PR does

<!-- Brief description -->

## Type of change

- [ ] Bug fix (spec compliance — interpreter disagrees with spec)
- [ ] New feature (spec addition or implementation)
- [ ] Refactor (no behavior change)
- [ ] Docs only

## Checklist

- [ ] All 25 existing tests still pass (`npm run build && node dist/main.js run tests/axon/*.axon`)
- [ ] New tests added for new behavior
- [ ] Spec updated if language semantics changed (`spec/` files)
- [ ] `spec/PRINCIPLES.md` still holds — no compromise on the two premises

## Test output

```
# paste: for f in tests/axon/*.axon; do node dist/main.js run "$f"; done
```
