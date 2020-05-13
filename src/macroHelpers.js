import babylon from '@babel/parser'

const SPREAD_ID = '__spread__'
const COMPUTED_ID = '__computed__'

function addImport({ types: t, program, mod, name, identifier }) {
  if (name === 'default') {
    program.unshiftContainer(
      'body',
      t.importDeclaration(
        [t.importDefaultSpecifier(identifier)],
        t.stringLiteral(mod)
      )
    )
  } else {
    program.unshiftContainer(
      'body',
      t.importDeclaration(
        [t.importSpecifier(identifier, t.identifier(name))],
        t.stringLiteral(mod)
      )
    )
  }
}

function assignify(objectAst, t) {
  if (objectAst.type !== 'ObjectExpression') return objectAst

  const cloneNode = t.cloneNode || t.cloneDeep
  const currentChunk = []
  const chunks = []

  objectAst.properties.forEach(property => {
    if (property.type === 'SpreadElement') {
      if (currentChunk.length > 0) {
        chunks.push(cloneNode(t.objectExpression(currentChunk)))
        currentChunk.length = 0
      }

      chunks.push(cloneNode(property.argument))
    } else {
      property.value = assignify(property.value, t)
      currentChunk.push(property)
    }
  })

  if (chunks.length === 0) return objectAst

  if (currentChunk.length > 0) {
    chunks.push(cloneNode(t.objectExpression(currentChunk)))
  }

  return t.callExpression(
    t.memberExpression(t.identifier('Object'), t.identifier('assign')),
    chunks
  )
}

function objectExpressionElements(literal, t, spreadType) {
  return Object.keys(literal)
    .filter(k => {
      return typeof literal[k] !== 'undefined'
    })
    .map(k => {
      if (k.startsWith(SPREAD_ID)) {
        return t[spreadType](babylon.parseExpression(literal[k]))
      }

      const computed = k.startsWith(COMPUTED_ID)
      const key = computed
        ? babylon.parseExpression(k.slice(12))
        : t.stringLiteral(k)
      return t.objectProperty(key, astify(literal[k], t), computed)
    })
}

function astify(literal, t) {
  if (literal === null) {
    return t.nullLiteral()
  }

  switch (typeof literal) {
    case 'function':
      return t.unaryExpression('void', t.numericLiteral(0), true)
    case 'number':
      return t.numericLiteral(literal)
    case 'boolean':
      return t.booleanLiteral(literal)
    case 'undefined':
      return t.unaryExpression('void', t.numericLiteral(0), true)
    case 'string':
      if (literal.startsWith(COMPUTED_ID)) {
        return babylon.parseExpression(literal.slice(COMPUTED_ID.length))
      }

      return t.stringLiteral(literal)
    default:
      // TODO: When is the literal an array? It's only an object/string
      if (Array.isArray(literal)) {
        return t.arrayExpression(literal.map(x => astify(x, t)))
      }

      // TODO: This is horrible, clean it up
      try {
        return t.objectExpression(
          objectExpressionElements(literal, t, 'spreadElement')
        )
      } catch (_) {
        return t.objectExpression(
          objectExpressionElements(literal, t, 'spreadProperty')
        )
      }
  }
}

function findIdentifier({ program, mod, name }) {
  let identifier = null

  program.traverse({
    ImportDeclaration(path) {
      if (path.node.source.value !== mod) return

      path.node.specifiers.some(specifier => {
        if (specifier.type === 'ImportDefaultSpecifier' && name === 'default') {
          identifier = specifier.local
          return true
        }

        if (specifier.imported.name === name) {
          identifier = specifier.local
          return true
        }

        return false
      })
    },
  })

  return identifier
}

function parseTte({ path, types: t, styledIdentifier, state }) {
  const cloneNode = t.cloneNode || t.cloneDeep

  if (
    path.node.tag.type !== 'Identifier' &&
    path.node.tag.type !== 'MemberExpression' &&
    path.node.tag.type !== 'CallExpression'
  )
    return null

  const string = path.get('quasi').evaluate().value
  const stringLoc = path.get('quasi').node.loc

  if (path.node.tag.type === 'CallExpression') {
    replaceWithLocation(
      path.get('tag').get('callee'),
      cloneNode(styledIdentifier)
    )
    state.shouldImportStyled = true
  } else if (path.node.tag.type === 'MemberExpression') {
    replaceWithLocation(
      path.get('tag').get('object'),
      cloneNode(styledIdentifier)
    )

    state.shouldImportStyled = true
  }

  if (
    path.node.tag.type === 'CallExpression' ||
    path.node.tag.type === 'MemberExpression'
  ) {
    replaceWithLocation(
      path,
      t.callExpression(cloneNode(path.node.tag), [
        t.identifier('__twPlaceholder'),
      ])
    )

    path = path.get('arguments')[0]
  }

  path.node.loc = stringLoc

  return { string, path }
}

function replaceWithLocation(path, replacement) {
  const newPaths = replacement ? path.replaceWith(replacement) : []
  if (Array.isArray(newPaths) && newPaths.length > 0) {
    const { loc } = path.node
    newPaths.forEach(p => {
      p.node.loc = loc
    })
  }

  return newPaths
}

export {
  SPREAD_ID,
  COMPUTED_ID,
  addImport,
  assignify,
  astify,
  findIdentifier,
  parseTte,
  replaceWithLocation,
}
