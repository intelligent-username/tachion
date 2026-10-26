// Shared d3 line/area generator helpers used across visualizer modules.
// Pure module — imports nothing from sibling modules.
import * as d3 from 'd3'

// Smoother curves only for dense series; Catmull-Rom keeps detail sparse
export function pickCurve(pointCount) {
    return pointCount > 80 ? d3.curveMonotoneX : d3.curveCatmullRom.alpha(0.5)
}

// Line/area generators over {x, y} points routed through the given scales
export function xyLine(xScale, yScale) {
    return d3.line().x(d => xScale(d.x)).y(d => yScale(d.y))
}

export function xyArea(xScale, yScale, y0) {
    return d3.area().x(d => xScale(d.x)).y0(y0).y1(d => yScale(d.y))
}

// Line/area generators over candle points (x = d._i, y = d.close)
export function indexLine(xScale, yScale, pointCount) {
    return d3.line()
        .x(d => xScale(d._i))
        .y(d => yScale(d.close))
        .curve(pickCurve(pointCount))
}

export function indexArea(xScale, yScale, y0, pointCount) {
    return d3.area()
        .x(d => xScale(d._i))
        .y0(y0)
        .y1(d => yScale(d.close))
        .curve(pickCurve(pointCount))
}
