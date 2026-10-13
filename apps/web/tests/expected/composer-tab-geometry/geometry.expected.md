# Input card position across the Chat and Trajectory tabs

## Wide viewport (1680px, card at its cap)

- Chat: scrollbar-gutter stable both-edges, overflow auto/auto
- Chat scroller scrolls: true
- Chat reserved band: 0px
- Trajectory: scrollbar-gutter auto, overflow hidden/auto
- Trajectory scroller scrolls: false
- Trajectory reserved band: 0px
- input card left edge moves between tabs: 0px
- input card right edge moves between tabs: 0px
- input card width changes between tabs: 0px
- transcript column centre sits off the card centre in Chat: 0px

## Narrow viewport (800px, card shrinking with the column)

- Chat: scrollbar-gutter stable both-edges, overflow auto/auto
- Chat scroller scrolls: true
- Chat reserved band: 0px
- Trajectory: scrollbar-gutter auto, overflow hidden/auto
- Trajectory scroller scrolls: false
- Trajectory reserved band: 0px
- input card left edge moves between tabs: 0px
- input card right edge moves between tabs: 0px
- input card width changes between tabs: 0px
- transcript column centre sits off the card centre in Chat: 0px

## Wide viewport, layout-consuming bar forced onto Chat without a reservation (control)

- Chat: scrollbar-gutter auto, overflow auto/auto
- Chat scroller scrolls: true
- Chat reserved band: 15px
- input card left edge: 468px
- input card right edge: 1492px
- input card width: 1024px
- transcript column centre: 972.5px
- input card centre: 980px
- transcript column centre sits off the card centre in Chat: 7.5px
