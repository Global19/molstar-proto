/**
 * Copyright (c) 2018 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { Unit, Structure, StructureElement } from 'mol-model/structure';
import { RuntimeContext, Task } from 'mol-task'
import { Tensor, Vec3, Mat4 } from 'mol-math/linear-algebra';
import { Box3D } from 'mol-math/geometry';
import { SizeTheme } from 'mol-view/theme/size';

export const DefaultGaussianDensityProps = {
    resolutionFactor: 6,
    radiusOffset: 0,
    smoothness: 1.5,
}
export type GaussianDensityProps = typeof DefaultGaussianDensityProps

function getDelta(box: Box3D, resolutionFactor: number) {
    const extent = Vec3.sub(Vec3.zero(), box.max, box.min)
    const n = Math.pow(Math.pow(2, resolutionFactor), 3)
    const f = (extent[0] * extent[1] * extent[2]) / n
    const s = Math.pow(f, 1 / 3)
    const size = Vec3.zero()
    Vec3.ceil(size, Vec3.scale(size, extent, s))
    const delta = Vec3.div(Vec3.zero(), extent, size)
    return delta
}

type Density = { transform: Mat4, field: Tensor, idField: Tensor }

export function computeGaussianDensity(unit: Unit, structure: Structure, props: GaussianDensityProps) {
    return Task.create('Gaussian Density', async ctx => {
        return await GaussianDensity(ctx, unit, structure, props);
    });
}

export async function GaussianDensity(ctx: RuntimeContext, unit: Unit, structure: Structure, props: GaussianDensityProps): Promise<Density> {
    const { resolutionFactor, radiusOffset, smoothness } = props

    const { elements } = unit;
    const elementCount = elements.length;
    const sizeTheme = SizeTheme({ name: 'physical' })

    const v = Vec3.zero()
    const p = Vec3.zero()
    const pos = unit.conformation.invariantPosition
    const l = StructureElement.create(unit)

    const pad = (radiusOffset + 3) * 3 // TODO calculate max radius
    const box = unit.lookup3d.boundary.box
    const expandedBox = Box3D.expand(Box3D.empty(), box, Vec3.create(pad, pad, pad));
    const extent = Vec3.sub(Vec3.zero(), expandedBox.max, expandedBox.min)
    const min = expandedBox.min

    const delta = getDelta(Box3D.expand(Box3D.empty(), structure.boundary.box, Vec3.create(pad, pad, pad)), resolutionFactor)
    const dim = Vec3.zero()
    Vec3.ceil(dim, Vec3.mul(dim, extent, delta))

    const space = Tensor.Space(dim, [0, 1, 2], Float32Array)
    const data = space.create()
    const field = Tensor.create(space, data)

    const idData = space.create()
    const idField = Tensor.create(space, idData)

    const densData = space.create()

    const c = Vec3.zero()

    const alpha = smoothness

    const _r2 = (radiusOffset + 1.4 * 2)
    const _radius2 = Vec3.create(_r2, _r2, _r2)
    Vec3.mul(_radius2, _radius2, delta)
    const updateChunk = Math.ceil(10000 / (_radius2[0] * _radius2[1] * _radius2[2]))

    const beg = Vec3.zero()
    const end = Vec3.zero()

    const gridPad = 1 / Math.max(...delta)

    for (let i = 0; i < elementCount; i++) {
        l.element = elements[i]
        pos(elements[i], v)

        Vec3.sub(v, v, min)
        Vec3.mul(c, v, delta)

        const radius = sizeTheme.size(l) + radiusOffset
        const rSq = radius * radius

        const r2 = radiusOffset + radius * 2 + gridPad
        const radius2 = Vec3.create(r2, r2, r2)
        Vec3.mul(radius2, radius2, delta)
        const r2sq = r2 * r2

        const [ begX, begY, begZ ] = Vec3.floor(beg, Vec3.sub(beg, c, radius2))
        const [ endX, endY, endZ ] = Vec3.ceil(end, Vec3.add(end, c, radius2))

        for (let x = begX; x < endX; ++x) {
            for (let y = begY; y < endY; ++y) {
                for (let z = begZ; z < endZ; ++z) {
                    Vec3.set(p, x, y, z)
                    Vec3.div(p, p, delta)
                    const distSq = Vec3.squaredDistance(p, v)
                    if (distSq <= r2sq) {
                        const dens = Math.exp(-alpha * (distSq / rSq))
                        space.add(data, x, y, z, dens)
                        if (dens > space.get(densData, x, y, z)) {
                            space.set(densData, x, y, z, dens)
                            space.set(idData, x, y, z, i)
                        }
                    }
                }
            }
        }

        if (i % updateChunk === 0 && ctx.shouldUpdate) {
            await ctx.update({ message: 'filling density grid', current: i, max: elementCount });
        }
    }

    const transform = Mat4.identity()
    Mat4.fromScaling(transform, Vec3.inverse(Vec3.zero(), delta))
    Mat4.setTranslation(transform, expandedBox.min)

    return { field, idField, transform }
}