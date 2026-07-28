#!/usr/bin/env npx tsx
/**
 * Contract verification script.
 *
 * Compares TypeScript Zod schemas with Python Pydantic models to ensure
 * they define the same fields and types. This ensures type-safe contracts
 * between agent-runtime and apps/server.
 *
 * Exit codes:
 * - 0: All contracts match
 * - 1: Contract mismatch found
 * - 2: Error during verification
 */

import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { zodToJsonSchema } from 'zod-to-json-schema'

// Import all Zod schemas
import {
  UpsertPromptNodeRequestSchema,
  UpsertPromptNodeResponseSchema,
  GetNodeRequestSchema,
  GetNodeResponseSchema,
  AddNodesBatchRequestSchema,
  AddNodesBatchResponseSchema,
  ConnectNodesRequestSchema,
  ConnectNodesResponseSchema,
  SetNodePromptRequestSchema,
  SetNodePromptResponseSchema,
  SetNodeContentRequestSchema,
  SetNodeContentResponseSchema,
  AttachRefsRequestSchema,
  AttachRefsResponseSchema,
  RunImageGenerationRequestSchema,
  RunImageGenerationResponseSchema,
  RunVideoGenerationRequestSchema,
  RunVideoGenerationResponseSchema,
  GetGenerationStatusRequestSchema,
  GetGenerationStatusResponseSchema,
  GetAgentMessagesRequestSchema,
  GetAgentMessagesResponseSchema,
  SaveAgentMessageRequestSchema,
  SaveAgentMessageResponseSchema,
} from '../packages/shared/src/agentContract'

interface ContractMapping {
  tsSchema: any
  pyModel: string
}

const CONTRACTS: Record<string, { request: ContractMapping; response: ContractMapping }> = {
  upsert_prompt_node: {
    request: { tsSchema: UpsertPromptNodeRequestSchema, pyModel: 'UpsertPromptNodeRequest' },
    response: { tsSchema: UpsertPromptNodeResponseSchema, pyModel: 'UpsertPromptNodeResponse' },
  },
  get_node: {
    request: { tsSchema: GetNodeRequestSchema, pyModel: 'GetNodeRequest' },
    response: { tsSchema: GetNodeResponseSchema, pyModel: 'GetNodeResponse' },
  },
  add_nodes_batch: {
    request: { tsSchema: AddNodesBatchRequestSchema, pyModel: 'AddNodesBatchRequest' },
    response: { tsSchema: AddNodesBatchResponseSchema, pyModel: 'AddNodesBatchResponse' },
  },
  connect_nodes: {
    request: { tsSchema: ConnectNodesRequestSchema, pyModel: 'ConnectNodesRequest' },
    response: { tsSchema: ConnectNodesResponseSchema, pyModel: 'ConnectNodesResponse' },
  },
  set_node_prompt: {
    request: { tsSchema: SetNodePromptRequestSchema, pyModel: 'SetNodePromptRequest' },
    response: { tsSchema: SetNodePromptResponseSchema, pyModel: 'SetNodePromptResponse' },
  },
  set_node_content: {
    request: { tsSchema: SetNodeContentRequestSchema, pyModel: 'SetNodeContentRequest' },
    response: { tsSchema: SetNodeContentResponseSchema, pyModel: 'SetNodeContentResponse' },
  },
  attach_refs: {
    request: { tsSchema: AttachRefsRequestSchema, pyModel: 'AttachRefsRequest' },
    response: { tsSchema: AttachRefsResponseSchema, pyModel: 'AttachRefsResponse' },
  },
  run_image_generation: {
    request: { tsSchema: RunImageGenerationRequestSchema, pyModel: 'RunImageGenerationRequest' },
    response: { tsSchema: RunImageGenerationResponseSchema, pyModel: 'RunImageGenerationResponse' },
  },
  run_video_generation: {
    request: { tsSchema: RunVideoGenerationRequestSchema, pyModel: 'RunVideoGenerationRequest' },
    response: { tsSchema: RunVideoGenerationResponseSchema, pyModel: 'RunVideoGenerationResponse' },
  },
  get_generation_status: {
    request: { tsSchema: GetGenerationStatusRequestSchema, pyModel: 'GetGenerationStatusRequest' },
    response: { tsSchema: GetGenerationStatusResponseSchema, pyModel: 'GetGenerationStatusResponse' },
  },
  get_agent_messages: {
    request: { tsSchema: GetAgentMessagesRequestSchema, pyModel: 'GetAgentMessagesRequest' },
    response: { tsSchema: GetAgentMessagesResponseSchema, pyModel: 'GetAgentMessagesResponse' },
  },
  save_agent_message: {
    request: { tsSchema: SaveAgentMessageRequestSchema, pyModel: 'SaveAgentMessageRequest' },
    response: { tsSchema: SaveAgentMessageResponseSchema, pyModel: 'SaveAgentMessageResponse' },
  },
}

function getPythonSchema(modelName: string): any {
  const script = `
import json
import sys
sys.path.insert(0, 'services/agent-runtime')
from app.contract import ${modelName}
from typing import get_origin, get_args
import typing

# Special handling for list types
if get_origin(${modelName}) is list or (${modelName} is list):
    # For list types, we need to create a wrapper model
    from pydantic import BaseModel
    class Wrapper(BaseModel):
        items: ${modelName}
    schema = Wrapper.model_json_schema()
    # Extract the items array schema
    schema = schema['properties']['items']
else:
    schema = ${modelName}.model_json_schema()

print(json.dumps(schema, indent=2))
`

  const tempFile = `/tmp/contract_verify_${modelName}.py`
  writeFileSync(tempFile, script)

  try {
    const output = execSync(`python3 ${tempFile}`, { encoding: 'utf-8', cwd: process.cwd() })
    return JSON.parse(output)
  } catch (error) {
    console.error(`Failed to get Python schema for ${modelName}:`, error)
    return null
  }
}

function compareSchemas(tsSchema: any, pySchema: any, path: string): string[] {
  const errors: string[] = []

  // Compare required fields
  const tsRequired = new Set(tsSchema.required || [])
  const pyRequired = new Set(pySchema.required || [])

  for (const field of tsRequired) {
    if (!pyRequired.has(field)) {
      errors.push(`${path}: Field '${field}' is required in TypeScript but not in Python`)
    }
  }

  for (const field of pyRequired) {
    if (!tsRequired.has(field)) {
      errors.push(`${path}: Field '${field}' is required in Python but not in TypeScript`)
    }
  }

  // Compare properties
  const tsProps = tsSchema.properties || {}
  const pyProps = pySchema.properties || {}

  const allFields = new Set([...Object.keys(tsProps), ...Object.keys(pyProps)])

  for (const field of allFields) {
    const tsField = tsProps[field]
    const pyField = pyProps[field]

    if (!tsField) {
      errors.push(`${path}: Field '${field}' exists in Python but not in TypeScript`)
      continue
    }

    if (!pyField) {
      errors.push(`${path}: Field '${field}' exists in TypeScript but not in Python`)
      continue
    }

    // Compare types
    const tsType = tsField.type
    const pyType = pyField.type

    // Extract types from anyOf (Python's representation of Optional)
    const extractTypes = (field: any): string[] => {
      if (field.anyOf) {
        // Python's anyOf for Optional fields
        return field.anyOf.map((item: any) => item.type).filter((t: string) => t !== 'null')
      }
      if (Array.isArray(field.type)) {
        // TypeScript's union type for optional fields
        return field.type.filter((t: string) => t !== 'undefined')
      }
      return [field.type].filter(Boolean)
    }

    const tsTypes = extractTypes(tsField)
    const pyTypes = extractTypes(pyField)

    // Check if types are compatible
    const typeCompatible = tsTypes.some((tsT) =>
      pyTypes.some((pyT) => {
        // Allow some type flexibility
        const allowedMappings: Record<string, Set<string>> = {
          string: new Set(['string']),
          number: new Set(['number', 'integer']),
          integer: new Set(['number', 'integer']),
          array: new Set(['array']),
          object: new Set(['object']),
          boolean: new Set(['boolean']),
        }

        const tsAllowed = allowedMappings[tsT] || new Set([tsT])
        const pyAllowed = allowedMappings[pyT] || new Set([pyT])

        return tsAllowed.has(pyT) || pyAllowed.has(tsT)
      })
    )

    if (!typeCompatible && tsTypes.length > 0 && pyTypes.length > 0) {
      errors.push(
        `${path}.${field}: Type mismatch - TypeScript has '${JSON.stringify(tsType)}', Python has '${JSON.stringify(
          pyType
        )}'`
      )
    }

    // Recursively compare nested objects
    if (tsField.type === 'object' && pyField.type === 'object') {
      errors.push(...compareSchemas(tsField, pyField, `${path}.${field}`))
    }

    // Compare array items
    if (tsField.type === 'array' && pyField.type === 'array') {
      const tsItems = tsField.items
      const pyItems = pyField.items
      if (tsItems && pyItems) {
        if (tsItems.type === 'object' && pyItems.type === 'object') {
          errors.push(...compareSchemas(tsItems, pyItems, `${path}.${field}[]`))
        }
      }
    }
  }

  return errors
}

function main() {
  console.log('🔍 Verifying contract schemas...\n')

  let hasErrors = false

  for (const [endpoint, { request, response }] of Object.entries(CONTRACTS)) {
    console.log(`\n📋 Checking ${endpoint}...`)

    // Check request schema
    console.log(`  Request: ${request.pyModel}`)
    const tsRequestSchema = zodToJsonSchema(request.tsSchema)
    const pyRequestSchema = getPythonSchema(request.pyModel)

    if (!pyRequestSchema) {
      console.error(`  ❌ Failed to load Python schema for ${request.pyModel}`)
      hasErrors = true
      continue
    }

    const requestErrors = compareSchemas(tsRequestSchema, pyRequestSchema, `${endpoint}.request`)
    if (requestErrors.length > 0) {
      console.error('  ❌ Request schema mismatch:')
      requestErrors.forEach((err) => console.error(`    ${err}`))
      hasErrors = true
    } else {
      console.log('  ✅ Request schema matches')
    }

    // Check response schema
    console.log(`  Response: ${response.pyModel}`)
    const tsResponseSchema = zodToJsonSchema(response.tsSchema)
    const pyResponseSchema = getPythonSchema(response.pyModel)

    if (!pyResponseSchema) {
      console.error(`  ❌ Failed to load Python schema for ${response.pyModel}`)
      hasErrors = true
      continue
    }

    const responseErrors = compareSchemas(tsResponseSchema, pyResponseSchema, `${endpoint}.response`)
    if (responseErrors.length > 0) {
      console.error('  ❌ Response schema mismatch:')
      responseErrors.forEach((err) => console.error(`    ${err}`))
      hasErrors = true
    } else {
      console.log('  ✅ Response schema matches')
    }
  }

  console.log('\n' + (hasErrors ? '❌ Contract verification failed' : '✅ All contracts verified successfully'))

  process.exit(hasErrors ? 1 : 0)
}

main()