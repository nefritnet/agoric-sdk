import { E } from '@agoric/eventual-send';
import { Far } from '@agoric/marshal';

// This vat contains the controller-side provisioning service. To enable local
// testing, it is loaded by both the controller and other ag-solo vat machines.

export function buildRootObject(_vatPowers) {
  let bundler;
  let comms;
  let vattp;

  async function register(b, c, v) {
    bundler = b;
    comms = c;
    vattp = v;
  }

  async function pleaseProvision(nickname, pubkey, powerFlags) {
    let chainBundle;
    const fetch = Far('fetch', {
      getDemoBundle() {
        return chainBundle;
      },
    });

    // Add a remote and egress for the pubkey.
    const { transmitter, setReceiver } = await E(vattp).addRemote(pubkey);
    await E(comms).addRemote(pubkey, transmitter, setReceiver);

    const INDEX = 1;
    await E(comms).addEgress(pubkey, INDEX, fetch);

    // Do this here so that any side-effects don't happen unless
    // the egress has been successfully added.
    chainBundle = E(bundler).createUserBundle(nickname, powerFlags || []);
    return { ingressIndex: INDEX };
  }

  return Far('root', { register, pleaseProvision });
}
