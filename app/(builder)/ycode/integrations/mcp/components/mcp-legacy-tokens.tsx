'use client';

import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDate, formatRelativeTime } from '@/lib/utils';
import { useCopyToClipboard } from './use-copy-to-clipboard';
import type { McpToken } from './types';

interface McpLegacyTokensProps {
  tokens: McpToken[];
  onGenerate: (name: string) => Promise<McpToken | null>;
  onDelete: (token: McpToken) => void;
}

/**
 * URL tokens embed a never-expiring secret in the MCP URL. They remain for
 * clients that cannot do OAuth, but are tucked under "Advanced" so OAuth is
 * the path users reach for first.
 */
export default function McpLegacyTokens({ tokens, onGenerate, onDelete }: McpLegacyTokensProps) {
  const [open, setOpen] = useState(tokens.length > 0);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [showUrlDialog, setShowUrlDialog] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [generatedToken, setGeneratedToken] = useState<McpToken | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  const handleGenerate = async () => {
    const name = newTokenName.trim();
    if (!name) return;

    setIsGenerating(true);
    try {
      const token = await onGenerate(name);
      if (token) {
        setGeneratedToken(token);
        setShowGenerateDialog(false);
        setShowUrlDialog(true);
        setNewTokenName('');
      }
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 self-start text-base font-medium hover:text-foreground/80 transition-colors cursor-pointer"
            >
              Legacy URL tokens
              <Icon
                name={open ? 'triangle-down' : 'triangle-right'}
                className="size-3 shrink-0 text-muted-foreground"
              />
            </button>
          </CollapsibleTrigger>
          <p className="text-sm text-muted-foreground">
            For clients that don&apos;t support OAuth. The token is part of the URL and never expires.
          </p>
        </div>

        <CollapsibleContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4 bg-secondary/20 p-4 rounded-lg">
            <p className="text-xs text-muted-foreground">
              Anyone with a URL token can access this project. Prefer the OAuth URL above whenever
              your client supports it.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0"
              onClick={() => setShowGenerateDialog(true)}
            >
              Generate URL token
            </Button>
          </div>

          {tokens.length > 0 && (
            <div className="flex flex-col gap-3">
              {tokens.map((token) => (
                <div
                  key={token.id}
                  className="flex items-center gap-4 p-4 bg-secondary/20 rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <Label className="font-medium truncate">{token.name}</Label>
                      <code className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded font-mono">
                        {token.token_prefix}…
                      </code>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Created {formatDate(token.created_at, 'MMM D, YYYY')} · {token.last_used_at ? `last used ${formatRelativeTime(token.last_used_at, false)}` : 'never used'}
                    </div>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="secondary"
                        size="xs"
                        aria-label={`Actions for ${token.name}`}
                      >
                        <Icon name="more" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => onDelete(token)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
        </CollapsibleContent>
      </div>

      <Dialog
        open={showGenerateDialog}
        onOpenChange={setShowGenerateDialog}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate URL token</DialogTitle>
            <DialogDescription>
              Create an MCP URL with an embedded token for clients that cannot use OAuth.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="token-name">Connection name</Label>
            <Input
              id="token-name"
              value={newTokenName}
              onChange={(e) => setNewTokenName(e.target.value)}
              placeholder="e.g. Windsurf"
              className="mt-2"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleGenerate();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setShowGenerateDialog(false);
                setNewTokenName('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={!newTokenName.trim() || isGenerating}
            >
              {isGenerating ? 'Generating...' : 'Generate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showUrlDialog}
        onOpenChange={setShowUrlDialog}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your MCP URL</DialogTitle>
            <DialogDescription>
              Copy this URL and paste it into your AI tool. This URL will only be shown once.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {generatedToken?.mcp_url && (
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-secondary px-3 py-2.5 rounded-lg font-mono break-all select-all">
                  {generatedToken.mcp_url}
                </code>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => copy(generatedToken.mcp_url!)}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-3">
              Keep this URL private. Anyone with this URL can access your Web Studio project through MCP.
            </p>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setShowUrlDialog(false);
                setGeneratedToken(null);
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Collapsible>
  );
}
