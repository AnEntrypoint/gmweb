#!/usr/bin/env node

// Test script for version-check service
// Verifies npm registry connection and version comparison logic

import { promisify } from 'util';
import https from 'https';

const sleep = promisify(setTimeout);

const TEST_PACKAGES = [
  'agentgui',
  'opencode-ai',
  'gloutie-oc',
  'proxypilot'
];

class VersionCheckTest {
  constructor() {
    this.results = [];
  }

  log(result, message) {
    const symbol = result ? '✓' : '✗';
    console.log(`${symbol} ${message}`);
    this.results.push(result);
  }

  // Test npm registry connectivity
  async testRegistryConnection() {
    console.log('\n=== Testing npm Registry Connectivity ===');
    let connected = false;

    try {
      const version = await this.fetchVersion('express');
      if (version) {
        this.log(true, `npm registry connection successful (latest express: ${version})`);
        connected = true;
      }
    } catch (e) {
      this.log(false, `npm registry connection failed: ${e.message}`);
    }

    return connected;
  }

  // Fetch version from npm registry
  async fetchVersion(packageName) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('timeout'));
      }, 8000);

      const options = {
        hostname: 'registry.npmjs.org',
        path: `/${packageName}`,
        method: 'GET',
        timeout: 8000,
        headers: { 'User-Agent': 'version-check-test/1.0' }
      };

      https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          clearTimeout(timeoutId);
          try {
            const info = JSON.parse(data);
            resolve(info['dist-tags']?.latest);
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject).end();
    });
  }

  // Test version comparison logic
  testVersionComparison() {
    console.log('\n=== Testing Version Comparison Logic ===');

    const tests = [
      { a: '1.0.0', b: '1.0.0', expected: false, name: 'same versions' },
      { a: '2.0.0', b: '1.9.9', expected: true, name: 'major version bump' },
      { a: '1.2.0', b: '1.1.9', expected: true, name: 'minor version bump' },
      { a: '1.0.3', b: '1.0.2', expected: true, name: 'patch version bump' },
      { a: '1.0.0-beta', b: '1.0.0', expected: false, name: 'beta vs stable' },
      { a: '2.1.0', b: '2.0.9', expected: true, name: 'minor > patch' },
      { a: '1.0.0', b: '1.0.1', expected: false, name: 'older < newer' }
    ];

    let passed = 0;
    for (const test of tests) {
      const result = this.isNewerVersion(test.a, test.b) === test.expected;
      this.log(result, `${test.name}: ${test.a} > ${test.b} = ${!test.expected}`);
      if (result) passed++;
    }

    console.log(`\nPassed ${passed}/${tests.length} version comparison tests`);
  }

  isNewerVersion(versionA, versionB) {
    if (!versionA || !versionB) return false;
    const parseVersion = (v) => {
      const parts = v.split(/[\.\-]/);
      return parts.slice(0, 3).map(p => {
        const num = parseInt(p, 10);
        return isNaN(num) ? 0 : num;
      });
    };

    const [a1, a2, a3] = parseVersion(versionA);
    const [b1, b2, b3] = parseVersion(versionB);

    if (a1 !== b1) return a1 > b1;
    if (a2 !== b2) return a2 > b2;
    if (a3 !== b3) return a3 > b3;
    return false;
  }

  // Test package availability
  async testPackageAvailability() {
    console.log('\n=== Testing Package Availability ===');

    for (const pkg of TEST_PACKAGES) {
      try {
        const version = await this.fetchVersion(pkg);
        if (version) {
          this.log(true, `${pkg} is available (latest: ${version})`);
        } else {
          this.log(false, `${pkg} returned no version`);
        }
      } catch (e) {
        this.log(false, `${pkg} failed: ${e.message}`);
      }
      await sleep(500); // Rate limiting
    }
  }

  // Test service definition
  async testServiceDefinition() {
    console.log('\n=== Testing Service Definition ===');

    try {
      const module = await import('./services/version-check.js');
      const service = module.default;

      this.log(!!service, 'Service module exports default');
      this.log(service.name === 'version-check', 'Service name is correct');
      this.log(service.type === 'system', 'Service type is system');
      this.log(service.requiresDesktop === false, 'Service does not require desktop');
      this.log(Array.isArray(service.dependencies), 'Service has dependencies array');
      this.log(typeof service.start === 'function', 'Service has start function');
      this.log(typeof service.health === 'function', 'Service has health function');
    } catch (e) {
      this.log(false, `Service definition error: ${e.message}`);
    }
  }

  // Summary
  summary() {
    console.log('\n=== Test Summary ===');
    const passed = this.results.filter(r => r).length;
    const total = this.results.length;
    const percent = Math.round((passed / total) * 100);
    console.log(`Passed: ${passed}/${total} (${percent}%)`);

    if (passed === total) {
      console.log('\n✓ All tests passed! Version-check service is ready.');
      process.exit(0);
    } else {
      console.log('\n✗ Some tests failed. Review output above.');
      process.exit(1);
    }
  }

  async runAll() {
    await this.testServiceDefinition();
    const connected = await this.testRegistryConnection();
    if (connected) {
      await this.testPackageAvailability();
    }
    this.testVersionComparison();
    this.summary();
  }
}

const tester = new VersionCheckTest();
tester.runAll().catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});
