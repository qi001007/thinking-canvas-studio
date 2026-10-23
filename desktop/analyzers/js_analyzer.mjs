#!/usr/bin/env node
/**
 * TypeScript/JavaScript structural graph analyzer.
 * Uses the TypeScript compiler already pinned by this repository.
 * Output is the same Scene/Card shape as the Python analyzer; view filtering is
 * applied by the Python host (graph_views.py).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const file = process.argv[2];
if (!file) {
	console.error('usage: node js_analyzer.mjs <file>');
	process.exit(2);
}

const source = readFileSync(file, 'utf8');
const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
const nodes = new Map();
const edges = new Map();
const scopeByOwner = new Map();
const topLevel = new Map();
const imports = new Map();
let truncated = false;
let calls = 0;

const moduleId = `js:module:${path.basename(file)}`;
addNode(moduleId, path.basename(file), { kind: 'module', path: path.basename(file) });

function scriptKind(fileName) {
	const ext = path.extname(fileName).toLowerCase();
	if (ext === '.tsx') return ts.ScriptKind.TSX;
	if (ext === '.ts') return ts.ScriptKind.TS;
	if (ext === '.jsx') return ts.ScriptKind.JSX;
	if (ext === '.js') return ts.ScriptKind.JS;
	return ts.ScriptKind.TS;
}

function lineOf(node) {
	return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function textOf(node) {
	const text = node.getText(sourceFile).replace(/\s+/g, ' ').trim();
	return text.length > 90 ? `${text.slice(0, 87)}...` : text;
}

function addNode(id, label, card, line) {
	if (nodes.has(id)) return id;
	if (nodes.size >= 320) {
		truncated = true;
		return undefined;
	}
	const node = { id, valueId: id, label, kind: 'static', card, origin: 'static' };
	if (line) node.metadata = { line };
	nodes.set(id, node);
	return id;
}

function addEdge(from, to, kind, label) {
	if (!from || !to || from === to || !nodes.has(from) || !nodes.has(to)) return;
	const key = `${from}|${to}|${kind}|${label ?? ''}`;
	if (edges.has(key)) return;
	edges.set(key, { id: `js-edge:${edges.size}`, from, to, kind, label });
}

function importNode(module, names) {
	const id = `js:import:${module}`;
	const node = addNode(id, module, { kind: 'import', module, names });
	if (node) {
		addEdge(moduleId, id, 'imports', module);
		for (const name of names) imports.set(name, id);
	}
	return node;
}

function functionNode(node, parentId, className, name) {
	const id = `js:function:${name}:${lineOf(node)}`;
	const params = (node.parameters ?? []).map(param => {
		const paramName = param.name.getText(sourceFile);
		const type = param.type ? textOf(param.type) : undefined;
		const defaultValue = param.initializer ? textOf(param.initializer) : undefined;
		return { name: paramName, type, defaultValue };
	});
	const paramsText = params.map(param => `${param.name}${param.type ? `: ${param.type}` : ''}`).join(', ');
	const returnType = node.type ? textOf(node.type) : undefined;
	const signature = `${name}(${paramsText})${returnType ? ` -> ${returnType}` : ''}`;
	const card = {
		kind: 'function',
		signature,
		input: paramsText,
		output: returnType ?? '?',
		params: params.map(param => param.name),
		returns: returnType,
		line: lineOf(node)
	};
	if (!addNode(id, name, card, lineOf(node))) return undefined;
	addEdge(parentId, id, className ? 'method' : 'defines', name);
	const scope = new Map();
	for (const param of params) {
		const paramId = `js:param:${id}:${param.name}`;
		addNode(paramId, param.name, { kind: 'parameter', name: param.name, type: param.type, defaultValue: param.defaultValue });
		addEdge(id, paramId, 'parameter', param.type ?? 'input');
		scope.set(param.name, paramId);
	}
	if (node.body) {
		if (ts.isBlock(node.body)) visitStatements(node.body.statements, id, id, className, scope);
		else visitExpression(node.body, id, id, className, scope);
	}
	return id;
}

function classNode(node) {
	const name = node.name?.getText(sourceFile) ?? 'class';
	const id = `js:class:${name}:${lineOf(node)}`;
	const bases = (node.heritageClauses ?? [])
		.filter(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)
		.flatMap(clause => clause.types.map(type => textOf(type)));
	const card = { kind: 'class', name, bases, fields: [], methods: [], line: lineOf(node) };
	if (!addNode(id, name, card, lineOf(node))) return undefined;
	addEdge(moduleId, id, 'defines', name);
	topLevel.set(name, id);
	for (const base of bases) {
		const baseNode = resolveType(base, new Map());
		if (baseNode) addEdge(id, baseNode, 'inherits', base);
		else {
			const external = addNode(`js:external:base:${base}`, base, { kind: 'external', target: base, category: 'base class' });
			if (external) addEdge(id, external, 'inherits', base);
		}
	}
	for (const member of node.members) {
		if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) {
			const methodName = ts.isConstructorDeclaration(member) ? 'constructor' : member.name?.getText(sourceFile) ?? 'method';
			card.methods.push(methodName);
			const methodId = functionNode(member, id, id, methodName === 'constructor' ? `${name}.__init__` : `${name}.${methodName}`);
			if (methodId) addEdge(id, methodId, 'method', methodName);
		} else if (ts.isPropertyDeclaration(member)) {
			const fieldName = member.name?.getText(sourceFile) ?? 'field';
			const fieldId = field(member, id, fieldName, member.type ? textOf(member.type) : undefined, member.initializer);
			if (fieldId) card.fields.push(fieldName);
		} else if (ts.isConstructorDeclaration(member)) {
			continue;
		}
	}
	return id;
}

function field(node, className, name, type, initializer) {
	const id = `js:field:${className}:${name}`;
	const card = valueCard(initializer, type);
	if (!addNode(id, name, card, lineOf(node))) return undefined;
	addEdge(className, id, 'field', type ?? 'field');
	if (initializer) visitExpression(initializer, className, undefined, className, new Map());
	return id;
}

function interfaceNode(node) {
	const name = node.name.getText(sourceFile);
	const card = { kind: 'class', name: `interface ${name}`, bases: node.heritageClauses?.flatMap(c => c.types.map(t => textOf(t))) ?? [], fields: [], methods: [], line: lineOf(node) };
	const id = `js:interface:${name}:${lineOf(node)}`;
	if (!addNode(id, `interface ${name}`, card, lineOf(node))) return undefined;
	addEdge(moduleId, id, 'defines', name);
	topLevel.set(name, id);
	for (const member of node.members) {
		if (ts.isPropertySignature(member)) {
			const fieldName = member.name.getText(sourceFile);
			const fieldId = addNode(`js:field:${id}:${fieldName}`, fieldName, valueCard(undefined, member.type ? textOf(member.type) : undefined));
			if (fieldId) { addEdge(id, fieldId, 'field', 'field'); card.fields.push(fieldName); }
		} else if (ts.isMethodSignature(member)) {
			const methodName = member.name.getText(sourceFile);
			const methodId = addNode(`js:interface-method:${id}:${methodName}`, methodName, { kind: 'function', signature: `${methodName}()`, input: '', output: member.type ? textOf(member.type) : '?', params: [], line: lineOf(member) }, lineOf(member));
			if (methodId) { addEdge(id, methodId, 'method', methodName); card.methods.push(methodName); }
		}
	}
	return id;
}

function visitStatements(statements, owner, functionId, className, scope) {
	for (const statement of statements) {
		if (truncated) return;
		if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				assignVariable(declaration, owner, functionId, className, scope);
			}
		} else if (ts.isExpressionStatement(statement)) {
			visitExpression(statement.expression, owner, functionId, className, scope);
		} else if (ts.isReturnStatement(statement)) {
			const value = statement.expression ? visitExpression(statement.expression, owner, functionId, className, scope) : undefined;
			if (value && functionId) addEdge(value, functionId, 'returns', 'return');
			if (statement.expression && functionId) {
				for (const name of namesIn(statement.expression)) {
					const node = resolve(name, scope, className);
					if (node) addEdge(node, functionId, 'returns', name);
				}
			}
		} else if (ts.isForStatement(statement) || ts.isWhileStatement(statement) || ts.isDoStatement(statement)) {
			const header = statement.getText(sourceFile).split('{')[0].replace(/\s+/g, ' ').trim();
			const loopId = addNode(`js:loop:${owner}:${lineOf(statement)}`, header, { kind: 'loop', header, line: lineOf(statement) }, lineOf(statement));
			if (loopId) {
				addEdge(owner, loopId, 'contains', 'loop');
				if (statement.condition) visitExpression(statement.condition, loopId, functionId, className, scope);
				visitStatements(statement.statement ? (ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement]) : [], loopId, functionId, className, scope);
			}
		} else if (ts.isForOfStatement(statement) || ts.isForInStatement(statement)) {
			const header = statement.getText(sourceFile).split('{')[0].replace(/\s+/g, ' ').trim();
			const loopId = addNode(`js:loop:${owner}:${lineOf(statement)}`, header, { kind: 'loop', header, line: lineOf(statement) }, lineOf(statement));
			if (loopId) {
				addEdge(owner, loopId, 'contains', 'loop');
				visitExpression(statement.expression, loopId, functionId, className, scope);
				visitStatements(statement.statement ? (ts.isBlock(statement.statement) ? statement.statement.statements : [statement.statement]) : [], loopId, functionId, className, scope);
			}
		} else if (ts.isIfStatement(statement)) {
			visitExpression(statement.expression, owner, functionId, className, scope);
			visitStatements(statement.thenStatement ? (ts.isBlock(statement.thenStatement) ? statement.thenStatement.statements : [statement.thenStatement]) : [], owner, functionId, className, scope);
			if (statement.elseStatement) visitStatements(ts.isBlock(statement.elseStatement) ? statement.elseStatement.statements : [statement.elseStatement], owner, functionId, className, scope);
		} else if (ts.isBlock(statement)) {
			visitStatements(statement.statements, owner, functionId, className, scope);
		} else if (ts.isTryStatement(statement)) {
			visitStatements(statement.tryBlock.statements, owner, functionId, className, scope);
			if (statement.catchClause) visitStatements(statement.catchClause.block.statements, owner, functionId, className, scope);
			if (statement.finallyBlock) visitStatements(statement.finallyBlock.statements, owner, functionId, className, scope);
		} else if (ts.isFunctionDeclaration(statement)) {
			functionNode(statement, owner, undefined, statement.name?.getText(sourceFile) ?? 'function');
		} else if (ts.isClassDeclaration(statement)) {
			classNode(statement);
		}
	}
}

function assignVariable(declaration, owner, functionId, className, scope) {
	const name = declaration.name.getText(sourceFile);
	const type = declaration.type ? textOf(declaration.type) : undefined;
	const initializer = declaration.initializer;
	const targetId = functionId ?? owner;
	const id = `js:var:${targetId}:${name}`;
	const card = valueCard(initializer, type);
	if (!addNode(id, name, card, lineOf(declaration))) return;
	addEdge(owner, id, 'defines', name);
	scope.set(name, id);
	if (initializer) {
		const value = visitExpression(initializer, owner, functionId, className, scope);
		if (value) addEdge(value, id, ts.isCallExpression(initializer) || ts.isNewExpression(initializer) ? 'produces' : 'flows', name);
	}
}

function visitExpression(expression, owner, functionId, className, scope) {
	if (!expression) return undefined;
	if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) {
		calls += 1;
		if (calls > 120) { truncated = true; return undefined; }
		const targetName = expression.expression.getText(sourceFile);
		const args = (expression.arguments ?? []).map(arg => textOf(arg));
		const callId = addNode(`js:call:${owner}:${lineOf(expression)}:${targetName}`, targetName, { kind: 'call', target: targetName, args, line: lineOf(expression) }, lineOf(expression));
		if (callId) {
			addEdge(owner, callId, 'calls', targetName);
			for (const arg of expression.arguments ?? []) {
				visitExpression(arg, callId, functionId, className, scope);
				for (const name of namesIn(arg)) {
					const node = resolve(name, scope, className);
					if (node) addEdge(node, callId, 'flows', name);
				}
			}
			const base = targetName.split('.')[0];
			const target = resolve(base, scope, className);
			if (target) {
				addEdge(callId, target, 'targets', targetName);
				const targetKind = nodes.get(target)?.card?.kind;
				if (targetKind === 'function' || targetKind === 'class' || targetKind === 'external') {
					addEdge(functionId ?? owner, target, 'calls', targetName);
				}
			} else {
				const external = addNode(`js:external:call:${targetName}`, targetName, { kind: 'external', target: targetName, category: 'external call' });
				if (external) {
					addEdge(callId, external, 'targets', targetName);
					addEdge(functionId ?? owner, external, 'calls', targetName);
				}
			}
		}
		return callId;
	}
	if (ts.isIdentifier(expression)) return resolve(expression.text, scope, className);
	if (ts.isPropertyAccessExpression(expression)) {
		if (expression.expression.getText(sourceFile) === 'this' && className) {
			const fieldId = addNode(`js:field:${className}:${expression.name.text}`, expression.name.text, { kind: 'variable', value: 'field' });
			if (fieldId && functionId) addEdge(fieldId, functionId, 'reads', expression.name.text);
			return fieldId;
		}
		return resolve(expression.expression.getText(sourceFile).split('.')[0], scope, className) ?? undefined;
	}
	if (ts.isBinaryExpression(expression)) {
		if (expression.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(expression.left) && expression.left.expression.getText(sourceFile) === 'this' && className) {
			const name = expression.left.name.text;
			const fieldId = addNode(`js:field:${className}:${name}`, name, valueCard(expression.right, undefined), lineOf(expression.left));
			if (fieldId) {
				addEdge(className, fieldId, 'field', name);
				if (functionId) addEdge(functionId, fieldId, 'writes', name);
				const value = visitExpression(expression.right, owner, functionId, className, scope);
				if (value) addEdge(value, fieldId, 'flows', name);
			}
			return fieldId;
		}
		visitExpression(expression.left, owner, functionId, className, scope);
		visitExpression(expression.right, owner, functionId, className, scope);
		return undefined;
	}
	for (const child of expression.getChildren(sourceFile)) {
		if (child.kind >= ts.SyntaxKind.FirstNode) visitExpression(child, owner, functionId, className, scope);
	}
	return undefined;
}

function resolve(name, scope, className) {
	if (scope?.has(name)) return scope.get(name);
	if (topLevel.has(name)) return topLevel.get(name);
	if (imports.has(name)) return imports.get(name);
	if (className) {
		const method = `js:function:${className}.${name}:`;
		for (const id of nodes.keys()) {
			if (id.startsWith(method)) return id;
		}
	}
	return undefined;
}

function resolveType(name, scope) {
	const base = name.split('<')[0].trim().split('.').pop();
	return resolve(base, scope, undefined);
}

function valueCard(expression, type) {
	const annotation = type;
	if (expression && ts.isArrayLiteralExpression(expression)) {
		return { kind: 'list', items: expression.elements.map(item => ({ value: textOf(item) })) };
	}
	if (expression && ts.isObjectLiteralExpression(expression)) {
		return {
			kind: 'dict',
			entries: expression.properties.filter(property => property.name).map(property => ({
				key: property.name.getText(sourceFile),
				value: property.initializer ? textOf(property.initializer) : ''
			}))
		};
	}
	if (expression && ts.isNewExpression(expression)) {
		const target = expression.expression.getText(sourceFile);
		if (target === 'Tensor' || target.endsWith('.Tensor') || target.endsWith('Tensor')) {
			return { kind: 'tensor', shape: [], preview: textOf(expression) };
		}
	}
	if (expression && ts.isCallExpression(expression)) return { kind: 'variable', value: textOf(expression) };
	if (expression && ts.isNumericLiteral(expression)) return { kind: 'variable', value: expression.getText(sourceFile) };
	if (expression && ts.isStringLiteral(expression)) return { kind: 'variable', value: textOf(expression) };
	if (annotation) return { kind: 'variable', value: annotation };
	return { kind: 'variable', value: expression ? textOf(expression) : 'unknown' };
}

function namesIn(node) {
	const result = [];
	function walk(current) {
		if (ts.isIdentifier(current)) {
			const value = current.text;
			if (!result.includes(value)) result.push(value);
		}
		ts.forEachChild(current, walk);
	}
	walk(node);
	return result;
}

function visitImports() {
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
			const names = [];
			const clause = statement.importClause;
			if (clause?.name) names.push(clause.name.text);
			if (clause?.namedBindings) {
				if (ts.isNamespaceImport(clause.namedBindings)) names.push(clause.namedBindings.name.text);
				else for (const element of clause.namedBindings.elements) names.push(element.name.text);
			}
			importNode(statement.moduleSpecifier.text, names);
		}
	}
}

function main() {
	visitImports();
	for (const statement of sourceFile.statements) {
		if (ts.isFunctionDeclaration(statement)) {
			const name = statement.name?.getText(sourceFile) ?? 'function';
			const id = functionNode(statement, moduleId, undefined, name);
			if (id) topLevel.set(name, id);
		} else if (ts.isClassDeclaration(statement)) {
			classNode(statement);
		} else if (ts.isInterfaceDeclaration(statement)) {
			interfaceNode(statement);
		} else if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				assignVariable(declaration, moduleId, undefined, undefined, new Map());
			}
		}
	}
	const nodeList = [...nodes.values()];
	const edgeList = [...edges.values()];
	process.stdout.write(JSON.stringify({
		scene: { nodes: nodeList, edges: edgeList },
		coverage: {
			state: truncated ? 'partial' : 'complete',
			reason: truncated ? 'Static analysis budget reached.' : null,
			knownMissing: truncated ? ['Static node/call budget reached.'] : []
		},
		stats: {
			nodes: nodeList.length,
			edges: edgeList.length,
			functions: nodeList.filter(node => node.card?.kind === 'function').length,
			classes: nodeList.filter(node => node.card?.kind === 'class').length
		},
		sourceFile: path.basename(file),
		traceLines: [],
		origin: 'static'
	}));
}

try {
	main();
} catch (error) {
	process.stdout.write(JSON.stringify({
		error: `TypeScript analysis failed: ${error instanceof Error ? error.message : String(error)}`,
		scene: { nodes: [], edges: [] },
		coverage: { state: 'unknown', reason: 'Analyzer failure.', knownMissing: ['static structure'] },
		stats: { nodes: 0, edges: 0, functions: 0, classes: 0 },
		sourceFile: path.basename(file),
		origin: 'static'
	}));
	process.exitCode = 1;
}
