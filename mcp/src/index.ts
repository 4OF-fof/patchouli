#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { PatchouliClient } from './client.js';

const server = new Server({
  name: 'patchouli-mcp',
  version: '2.0.0',
});

const patchouliClient = new PatchouliClient();

const tools: Tool[] = [
  {
    name: 'authenticate',
    description: 'Authenticate with Patchouli server using OAuth2 and JWT tokens',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'exchange_code_for_token',
    description: 'Exchange OAuth2 authorization code for JWT access token',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'OAuth2 authorization code from callback URL',
        },
        state: {
          type: 'string',
          description: 'OAuth2 state parameter from callback URL',
        },
      },
      required: ['code', 'state'],
    },
  },
  {
    name: 'set_jwt_token',
    description: 'Manually set JWT token for authentication',
    inputSchema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: 'JWT access token',
        },
      },
      required: ['token'],
    },
  },
  {
    name: 'get_protected_content',
    description: 'Get protected content from Patchouli Knowledge Base for authenticated users',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_system_status',
    description: 'Get system status and information about the Patchouli server',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'health_check',
    description: 'Check if the Patchouli server is accessible',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'logout',
    description: 'Logout and clear the current JWT token',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'authenticate':
      try {
        await patchouliClient.authenticate();
        
        return {
          content: [
            {
              type: 'text',
              text: 'Authentication flow started. Please complete OAuth in your browser and use "exchange_code_for_token" with the authorization code from the callback URL.',
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [
            {
              type: 'text',
              text: `Authentication failed: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }

    case 'exchange_code_for_token':
      try {
        const { code, state } = args as { code: string; state: string };
        const tokenResponse = await patchouliClient.exchangeCodeForToken(code, state);
        
        return {
          content: [
            {
              type: 'text',
              text: `Authentication successful! 
User: ${tokenResponse.user.name} (${tokenResponse.user.email})
Permissions: ${tokenResponse.user.is_root ? 'Root User' : 'Regular User'}${tokenResponse.user.can_invite ? ', Can Invite' : ''}
Token expires in: ${tokenResponse.expires_in} seconds
JWT token has been stored for subsequent requests.`,
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [
            {
              type: 'text',
              text: `Token exchange failed: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }

    case 'set_jwt_token':
      try {
        const { token } = args as { token: string };
        patchouliClient.setJWTToken(token);
        
        // Validate the token
        const isValid = await patchouliClient.validateToken();
        if (isValid) {
          return {
            content: [
              {
                type: 'text',
                text: 'JWT token set and validated successfully.',
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: 'JWT token set but validation failed. The token may be invalid or expired.',
              },
            ],
            isError: true,
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [
            {
              type: 'text',
              text: `Failed to set JWT token: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }

    case 'get_protected_content':
      try {
        if (!patchouliClient.isAuthenticated()) {
          return {
            content: [
              {
                type: 'text',
                text: 'Not authenticated. Please use "authenticate" and "exchange_code_for_token" or "set_jwt_token" first.',
              },
            ],
            isError: true,
          };
        }

        const content = await patchouliClient.getProtectedContent();
        
        return {
          content: [
            {
              type: 'text',
              text: `Protected Content Retrieved:

${content.message}

Retrieved for user: ${content.user}
Timestamp: ${new Date(content.timestamp).toLocaleString()}`,
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }

    case 'get_system_status':
      try {
        const status = await patchouliClient.getSystemStatus();
        
        return {
          content: [
            {
              type: 'text',
              text: `Patchouli System Status:

Status: ${status.status}
Version: ${status.version}
Users Registered: ${status.users_registered}
Root User Exists: ${status.root_user_exists ? 'Yes' : 'No'}
Timestamp: ${new Date(status.timestamp).toLocaleString()}`,
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }

    case 'health_check':
      try {
        const isHealthy = await patchouliClient.healthCheck();
        
        return {
          content: [
            {
              type: 'text',
              text: `Patchouli Server Health: ${isHealthy ? 'Healthy ✅' : 'Unhealthy ❌'}`,
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [
            {
              type: 'text',
              text: `Health check failed: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }

    case 'logout':
      try {
        await patchouliClient.logout();
        
        return {
          content: [
            {
              type: 'text',
              text: 'Logout successful. JWT token has been cleared.',
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [
            {
              type: 'text',
              text: `Logout failed: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Patchouli MCP server v2.0.0 running on stdio (RESTful API compatible)');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
  });
}