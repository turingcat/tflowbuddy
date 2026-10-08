/** Product versions are independent of upstream and third-party release numbers. */
import { globSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { isEntry } from './release/process.ts'

function versionValue(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.test(value)) {
    throw new Error('Expected a complete product version')
  }
  return value
}

function manifests(root: string): string[] {
  return ['package.json', ...globSync(['apps/*/package.json', 'packages/*/*/package.json'], { cwd: root }).map(path => path.replaceAll('\\', '/')).sort()]
}

function readVersion(root: string, path: string): string {
  const data = JSON.parse(readFileSync(join(root, path), 'utf8')) as { version?: unknown }
  return versionValue(data.version)
}

/**
 * Check all first-party versions, including private packages.
 * @param root - Product checkout.
 * @param tag - Optional exact release tag.
 * @returns The complete product version; throws on mismatches.
 */
export function checkProductVersions(root: string, tag?: string): string {
  const version = readVersion(root, 'package.json')
  const mismatches = manifests(root).filter(path => readVersion(root, path) !== version)
  if (mismatches.length > 0) throw new Error(`Product version ${version} differs: ${mismatches.join(', ')}`)
  if (tag !== undefined && tag !== `v${version}`) throw new Error(`Release tag must be v${version}`)
  return version
}

/**
 * Normalize first-party manifest versions without changing dependencies.
 * @param root - Product checkout.
 * @param version - Explicit product version.
 * @returns Changed repository-relative manifest paths.
 */
export function normalizeProductVersions(root: string, version: string): string[] {
  versionValue(version)
  const changes = manifests(root).flatMap((path) => {
    const text = readFileSync(join(root, path), 'utf8')
    const before = readVersion(root, path)
    if (before === version) return []
    const source = ts.parseJsonText(path, text)
    const statement = source.statements[0]
    if (statement === undefined || !ts.isExpressionStatement(statement) || !ts.isObjectLiteralExpression(statement.expression)) {
      throw new Error(`Invalid manifest: ${path}`)
    }
    const property = statement.expression.properties.find(item => ts.isPropertyAssignment(item)
      && ts.isStringLiteral(item.name) && item.name.text === 'version')
    if (property === undefined || !ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.initializer)) {
      throw new Error(`Missing version field: ${path}`)
    }
    const next = text.slice(0, property.initializer.getStart(source)) + JSON.stringify(version) + text.slice(property.initializer.end)
    if (next === text) throw new Error(`Missing version field: ${path}`)
    return [{ path, text: next }]
  })
  for (const change of changes) writeFileSync(join(root, change.path), change.text)
  return changes.map(change => change.path)
}

if (isEntry(import.meta.url)) {
  const [command, version] = process.argv.slice(2)
  if (command === 'check') console.log(checkProductVersions(process.cwd(), process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined))
  else if (command === 'set' && version !== undefined) console.log(normalizeProductVersions(process.cwd(), version))
  else throw new Error('Usage: product-version.ts check | set <version>')
}
