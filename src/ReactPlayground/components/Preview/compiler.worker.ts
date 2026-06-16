import { transform } from '@babel/standalone'
import { File, Files } from '../../PlaygroundContext'
import { ENTRY_FILE_NAME } from '../../files'

const LEGACY_ENTRY_FILE_NAME = 'main.tsx'

export const beforeTransformCode = (filename: string, code: string) => {
    let _code = code
    const regexReact = /import\s+React/g
    if ((filename.endsWith('.jsx') || filename.endsWith('.tsx')) && !regexReact.test(code)) {
      _code = `import React from 'react';\n${code}`
    }
    return _code
}

export const babelTransform = (filename: string, code: string, files: Files) => {
    let _code = beforeTransformCode(filename, code);
    let result = ''
    try {
        result = transform(_code, {
        presets: ['react', 'typescript'],
        filename,
        plugins: [customResolver(files, filename)],
        retainLines: true
        }).code!
    } catch (e) {
        console.error('编译出错', e);
    }
    return result
}

const dirname = (path: string) => path.split('/').slice(0, -1).join('/')

const normalizeSegments = (path: string) => {
    const parts: string[] = []
    path.split('/').forEach((part) => {
        if (!part || part === '.') return
        if (part === '..') {
            parts.pop()
            return
        }
        parts.push(part)
    })
    return parts.join('/')
}

const getModuleFile = (files: Files, importer: string, modulePath: string) => {
    let moduleName = normalizeSegments(`${dirname(importer)}/${modulePath}`)
    const exactFile = files[moduleName]
    if (exactFile) return exactFile

    if (!moduleName.includes('.')) {
        const realModuleName = [
            `${moduleName}.ts`,
            `${moduleName}.tsx`,
            `${moduleName}.js`,
            `${moduleName}.jsx`,
            `${moduleName}.json`,
            `${moduleName}.css`,
            `${moduleName}/index.ts`,
            `${moduleName}/index.tsx`,
        ].find((key) => files[key])
        if (realModuleName) {
            moduleName = realModuleName
        }
      }
    return files[moduleName]
}

const json2Js = (file: File) => {
    const js = `export default ${file.value}`
    return URL.createObjectURL(new Blob([js], { type: 'application/javascript' }))
}

const css2Js = (file: File) => {
    const randomId = new Date().getTime()
    const js = `
(() => {
    const stylesheet = document.createElement('style')
    stylesheet.setAttribute('id', 'style_${randomId}_${file.name}')
    document.head.appendChild(stylesheet)

    const styles = document.createTextNode(\`${file.value}\`)
    stylesheet.innerHTML = ''
    stylesheet.appendChild(styles)
})()
    `
    return URL.createObjectURL(new Blob([js], { type: 'application/javascript' }))
}

function customResolver(files: Files, filename: string) {
    return {
        visitor: {
            ImportDeclaration(path: any) {
                const modulePath = path.node.source.value
                if(modulePath.startsWith('.')) {
                    const file = getModuleFile(files, filename, modulePath)
                    if(!file) 
                        return

                    if (file.name.endsWith('.css')) {
                        path.node.source.value = css2Js(file)
                    } else if (file.name.endsWith('.json')) {
                        path.node.source.value = json2Js(file)
                    } else {
                        path.node.source.value = URL.createObjectURL(
                            new Blob([babelTransform(file.name, file.value, files)], {
                                type: 'application/javascript',
                            })
                        )
                    }
                }
            }
        }
    }
}

export const compile = (files: Files) => {
  const main = files[ENTRY_FILE_NAME] || files[LEGACY_ENTRY_FILE_NAME]
  if (!main) {
    throw new Error(`Entry file not found. Expected ${ENTRY_FILE_NAME} or ${LEGACY_ENTRY_FILE_NAME}.`)
  }
  return babelTransform(main.name, main.value, files)
}

self.addEventListener('message', async ({ data }) => {
    try {
        self.postMessage({
            type: 'COMPILED_CODE',
            data: compile(data)
        })
    } catch (e) {
      self.postMessage({ type: 'ERROR', error: e })
    }
})
