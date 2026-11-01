import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultHostFor, hostsAfterSlugChange, hostsForNewSite, isSitesDomainName, sitesDomain } from './site-hosts';

const DOMAIN = 'sites.torchcorp.com';

describe('sitesDomain', () => {
  it('reads WS_SITES_DOMAIN, lower case, without surrounding dots', () => {
    assert.equal(sitesDomain({ WS_SITES_DOMAIN: ' .Sites.TorchCorp.com. ' }), DOMAIN);
  });
  it('refuses to guess when it is missing', () => {
    assert.throws(() => sitesDomain({}), /WS_SITES_DOMAIN is not set/);
    assert.throws(() => sitesDomain({ WS_SITES_DOMAIN: '  ' }), /WS_SITES_DOMAIN is not set/);
  });
});

describe('default address', () => {
  it('is {slug}.{domain}', () => {
    assert.equal(defaultHostFor('al-noor', DOMAIN), 'al-noor.sites.torchcorp.com');
  });
  it('is a sites-domain name, as is the bare domain, in any case; a look-alike is not', () => {
    assert.equal(isSitesDomainName('al-noor.sites.torchcorp.com', DOMAIN), true);
    assert.equal(isSitesDomainName('sites.torchcorp.com', DOMAIN), true);
    assert.equal(isSitesDomainName('Other.Sites.TorchCorp.com', DOMAIN), true);
    assert.equal(isSitesDomainName('evilsites.torchcorp.com', DOMAIN), false);
  });
});

describe('hostsForNewSite', () => {
  it('puts the default address first and drops repeats', () => {
    assert.deepEqual(hostsForNewSite('a', ['shop.example.com', 'a.sites.torchcorp.com'], DOMAIN), ['a.sites.torchcorp.com', 'shop.example.com']);
  });
});

describe('hostsAfterSlugChange', () => {
  it('replaces the old default address in place and keeps custom hosts', () => {
    assert.deepEqual(
      hostsAfterSlugChange(['old.sites.torchcorp.com', 'shop.example.com'], 'old', 'new', DOMAIN),
      ['new.sites.torchcorp.com', 'shop.example.com'],
    );
  });
  it('adds the new default address when the old one is missing', () => {
    assert.deepEqual(hostsAfterSlugChange(['shop.example.com'], 'old', 'new', DOMAIN), ['new.sites.torchcorp.com', 'shop.example.com']);
  });
});
