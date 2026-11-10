'use client';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

interface McpClientInstructionsProps {
  url: string;
  isLocalhost: boolean;
}

interface Step {
  text: React.ReactNode;
}

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex flex-col gap-1.5 text-sm text-muted-foreground list-decimal pl-5">
      {steps.map((step, index) => (
        <li key={index}>{step.text}</li>
      ))}
    </ol>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="text-xs bg-secondary px-3 py-2.5 rounded-lg font-mono whitespace-pre-wrap break-all select-all">
      {children}
    </pre>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

/**
 * Per-client connection instructions for the OAuth MCP endpoint.
 *
 * Self-hosted projects are not listed in any vendor connector directory (each
 * install has its own URL), so every client is set up as a custom / manual
 * connector pointing at this project's URL.
 */
export default function McpClientInstructions({ url, isLocalhost }: McpClientInstructionsProps) {
  const hostedOnlyNote = isLocalhost ? (
    <Note>
      This client connects from the vendor&apos;s servers, so it needs a public HTTPS URL. It
      can&apos;t reach <code className="font-mono">localhost</code> — deploy Web Studio first, or use
      Cursor, Claude Code, or VS Code for local development.
    </Note>
  ) : null;

  const cursorConfig = JSON.stringify({ mcpServers: { ycode: { url } } }, null, 2);

  const permissionsNote = (
    <Note>
      The first time the assistant uses a tool it asks for your permission. Choose{' '}
      <strong>Always allow</strong> for the editing tools — every change is a draft until you
      publish — and keep <strong>Publish</strong> and the delete tools on ask.
    </Note>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-base font-medium">How to connect</span>
        <p className="text-sm text-muted-foreground">
          Self-hosted Web Studio projects aren&apos;t listed in the Claude or ChatGPT connector
          directories, because every project has its own URL. Add this project as a
          <strong> custom connector</strong> instead — the steps below cover each client.
        </p>
      </div>

      <Tabs
        defaultValue="claude"
        className="gap-4"
      >
        <TabsList className="w-full">
          <TabsTrigger value="claude">Claude</TabsTrigger>
          <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
          <TabsTrigger value="cursor">Cursor</TabsTrigger>
          <TabsTrigger value="chatgpt">ChatGPT</TabsTrigger>
          <TabsTrigger value="vscode">VS Code</TabsTrigger>
        </TabsList>

        <TabsContent
          value="claude"
          className="flex flex-col gap-3 bg-secondary/20 p-5 rounded-lg"
        >
          <span className="text-sm font-medium">Claude Desktop and Claude.ai</span>
          <Steps
            steps={[
              { text: <>Open <strong>Settings → Connectors</strong>.</> },
              { text: <>Scroll past the directory and click <strong>Add custom connector</strong>.</> },
              { text: <>Name it “Web Studio” and paste the MCP server URL into <strong>Remote MCP server URL</strong>. Leave the OAuth client ID and secret fields empty.</> },
              { text: <>Click <strong>Add</strong>, then <strong>Connect</strong>. Sign in to Web Studio and approve access.</> },
            ]}
          />
          <Note>
            Custom connectors require a paid Claude plan (Pro, Max, Team, or Enterprise). On Team
            and Enterprise plans an owner may need to add the connector for the organization.
          </Note>
          {permissionsNote}
          {hostedOnlyNote}
        </TabsContent>

        <TabsContent
          value="claude-code"
          className="flex flex-col gap-3 bg-secondary/20 p-5 rounded-lg"
        >
          <span className="text-sm font-medium">Claude Code</span>
          <Steps
            steps={[
              { text: 'Run in your terminal:' },
            ]}
          />
          <CodeBlock>{`claude mcp add --transport http ycode ${url}`}</CodeBlock>
          <Steps
            steps={[
              { text: <>In Claude Code, run <code className="font-mono">/mcp</code> and choose <strong>ycode</strong> to sign in.</> },
            ]}
          />
        </TabsContent>

        <TabsContent
          value="cursor"
          className="flex flex-col gap-3 bg-secondary/20 p-5 rounded-lg"
        >
          <span className="text-sm font-medium">Cursor</span>
          <Steps
            steps={[
              { text: <>Open <strong>Settings → MCP</strong> and click <strong>Add new MCP server</strong>, or edit <code className="font-mono">.cursor/mcp.json</code> directly:</> },
            ]}
          />
          <CodeBlock>{cursorConfig}</CodeBlock>
          <Steps
            steps={[
              { text: 'Cursor will open a browser window to sign in to Web Studio and approve access.' },
            ]}
          />
        </TabsContent>

        <TabsContent
          value="chatgpt"
          className="flex flex-col gap-3 bg-secondary/20 p-5 rounded-lg"
        >
          <span className="text-sm font-medium">ChatGPT</span>
          <Steps
            steps={[
              { text: <>Open <strong>Settings → Connectors</strong> and enable <strong>Developer mode</strong> (under Advanced).</> },
              { text: <>Click <strong>Create</strong>, name it “Web Studio”, and paste the MCP server URL.</> },
              { text: <>Choose <strong>OAuth</strong> authentication, then sign in to Web Studio and approve access.</> },
            ]}
          />
          <Note>
            Developer mode connectors are available on ChatGPT Plus, Pro, Business, Enterprise, and
            Edu plans.
          </Note>
          {hostedOnlyNote}
        </TabsContent>

        <TabsContent
          value="vscode"
          className="flex flex-col gap-3 bg-secondary/20 p-5 rounded-lg"
        >
          <span className="text-sm font-medium">VS Code</span>
          <Steps
            steps={[
              { text: 'Run in your terminal:' },
            ]}
          />
          <CodeBlock>{`code --add-mcp '${JSON.stringify({ name: 'ycode', type: 'http', url })}'`}</CodeBlock>
          <Steps
            steps={[
              { text: <>Open the Chat view, click the tools icon, and start the <strong>ycode</strong> server to sign in.</> },
            ]}
          />
        </TabsContent>
      </Tabs>

      <Note>
        Any client that supports the MCP Streamable HTTP transport with OAuth can connect using the
        URL above. Approved connections appear in the list and can be revoked at any time. Most
        clients ask before the assistant edits anything; allowing the editing tools once is safe
        because changes stay drafts until published. If your
        project is served from several hostnames or behind a reverse proxy, set
        <code className="font-mono"> NEXT_PUBLIC_MCP_SERVER_URL</code> to the public URL clients
        should use.
      </Note>
    </div>
  );
}
