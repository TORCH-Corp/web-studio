'use client';

/**
 * Form Settings Component
 *
 * Settings panel for form layers with submission handling configuration
 */

import React, { useState, useCallback } from 'react';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SettingsPanel from './SettingsPanel';
import LinkSettings from './LinkSettings';
import type { Layer, FormSettings as FormSettingsType, LinkSettingsValue } from '@/types';

interface FormSettingsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
}

export default function FormSettings({ layer, onLayerUpdate }: FormSettingsProps) {
  const [isOpen, setIsOpen] = useState(true);

  // Get current form settings
  const formSettings: FormSettingsType = layer?.settings?.form || {};
  const successAction = formSettings.success_action || 'message';
  const handleRedirectLinkChange = useCallback(
    (value: LinkSettingsValue | null) => {
      if (!layer) return;

      onLayerUpdate(layer.id, {
        settings: {
          ...layer.settings,
          form: {
            ...layer.settings?.form,
            redirect_url: value ?? undefined,
          },
        },
      });
    },
    [layer, onLayerUpdate]
  );

  const handleSettingChange = useCallback(
    (key: keyof FormSettingsType, value: any) => {
      if (!layer) return;

      onLayerUpdate(layer.id, {
        settings: {
          ...layer.settings,
          form: {
            ...layer.settings?.form,
            [key]: value,
          },
        },
      });
    },
    [layer, onLayerUpdate]
  );

  // Only show for form layers
  if (!layer || layer.name !== 'form') {
    return null;
  }

  // Password-protected forms gate access to locked pages — they are wired to
  // /api/page-auth/verify automatically, so the standard form options
  // (success action, redirect) don't apply.
  const isPasswordForm = formSettings.form_type === 'password_protected';

  if (isPasswordForm) {
    return (
      <SettingsPanel
        title="Form Settings"
        isOpen={isOpen}
        onToggle={() => setIsOpen(!isOpen)}
      >
        <div className="text-xs text-muted-foreground leading-relaxed">
          This form gates access to password-protected pages. Style it freely;
          the submit handler is wired automatically. On a wrong password, the
          Error alert layer inside the form is shown.
        </div>
      </SettingsPanel>
    );
  }

  return (
    <SettingsPanel
      title="Form Settings"
      isOpen={isOpen}
      onToggle={() => setIsOpen(!isOpen)}
    >
      <div className="flex flex-col gap-2.5">
        {/* Success Action Toggle */}
        <div className="grid grid-cols-3">
          <Label variant="muted">Success</Label>
          <div className="col-span-2 *:w-full">
            <Tabs
              value={successAction}
              onValueChange={(value) => handleSettingChange('success_action', value)}
              className="w-full"
            >
              <TabsList className="w-full">
                <TabsTrigger value="message" className="flex-1 text-xs">
                  Message
                </TabsTrigger>
                <TabsTrigger value="redirect" className="flex-1 text-xs">
                  Redirect
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        {/* Redirect destination - only show when redirect is selected */}
        {successAction === 'redirect' && (
          <LinkSettings
            mode="standalone"
            value={formSettings.redirect_url}
            onChange={handleRedirectLinkChange}
            gridLayout
            typeLabel="Redirect to"
            allowedTypes={['page', 'url']}
            hideBehavior
          />
        )}

        {/* TORCH (part 3, session W3): the store refuses the switch for a form without a required name and phone, and says why */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="create-prospect">Create a prospect in Contact Center</Label>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Each submission becomes a prospect. The form keeps a required name and phone field.
            </p>
          </div>
          <Switch
            id="create-prospect"
            size="sm"
            checked={formSettings.create_prospect === true}
            onCheckedChange={(checked) => handleSettingChange('create_prospect', checked)}
          />
        </div>

      </div>
    </SettingsPanel>
  );
}
