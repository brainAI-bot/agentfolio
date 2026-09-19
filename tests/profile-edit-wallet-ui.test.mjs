import test from "node:test";
import assert from "node:assert/strict";
import { walletAuthenticatedProfileEdit } from "../frontend/src/lib/profile-edit-auth.ts";

const canonicalId = "agent_owner";
const walletAddress = "OwnerWallet111111111111111111111111111111111";
const editBody = {
  bio: "updated from wallet",
  handle: "owner",
  links: { website: "https://example.com", x: "owner", github: "owner", moltbook: "" },
};

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("wallet profile edit mints and signs a canonical exact-request challenge", async () => {
  const calls = [];
  const challenge = {
    challengeId: "mwc_test",
    nonce: "nonce",
    action: "profile.edit",
    resourceId: canonicalId,
    method: "PATCH",
    path: `/api/profile/${canonicalId}`,
    actorId: canonicalId,
    walletAddress,
    identityPDA: "identity",
    bodyDigest: "digest",
    issuedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    message: "signed canonical challenge",
  };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return calls.length === 1
      ? jsonResponse(201, challenge)
      : jsonResponse(200, { updated: true, profile: { id: canonicalId } });
  };
  let signedMessage;
  const result = await walletAuthenticatedProfileEdit({
    profileId: canonicalId,
    walletAddress,
    body: editBody,
    signMessage: async (message) => {
      signedMessage = new TextDecoder().decode(message);
      return new Uint8Array([1, 2, 3]);
    },
    fetchImpl,
  });

  assert.equal(result.updated, true);
  assert.equal(signedMessage, challenge.message);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/marketplace/auth/challenge");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].body, {
    action: "profile.edit",
    resourceId: canonicalId,
    actorId: canonicalId,
    method: "PATCH",
    path: `/api/profile/${canonicalId}`,
    body: { ...editBody, actorId: canonicalId },
  });
  assert.equal(calls[1].url, `/api/profile/${canonicalId}`);
  assert.equal(calls[1].init.method, "PATCH");
  assert.deepEqual(
    { ...calls[1].body, walletChallenge: undefined },
    { ...editBody, actorId: canonicalId, walletChallenge: undefined },
  );
  assert.equal(calls[1].body.walletChallenge.challengeId, challenge.challengeId);
  assert.equal(calls[1].body.walletChallenge.signature, "AQID");
});

test("wallet mismatch fails closed before profile PATCH", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse(201, {
      challengeId: "mwc_wrong_wallet",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      message: "do not sign",
      walletAddress: "DifferentWallet1111111111111111111111111111111",
    });
  };

  await assert.rejects(
    walletAuthenticatedProfileEdit({
      profileId: canonicalId,
      walletAddress,
      body: editBody,
      signMessage: async () => new Uint8Array([1]),
      fetchImpl,
    }),
    /connected wallet is not the profile wallet selected by the server/,
  );
  assert.equal(calls, 1);
});
