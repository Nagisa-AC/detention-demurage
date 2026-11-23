import {
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { CliError } from "./cli-error.js";
import { createUserInput, oneTimePassword, setPasswordInput, type PortalUserCognito } from "./portal-user.js";

export function cognitoAdmin(env: NodeJS.ProcessEnv): PortalUserCognito {
  const region = env.PORTAL_COGNITO_REGION && /^us-[a-z0-9-]+$/.test(env.PORTAL_COGNITO_REGION) ? env.PORTAL_COGNITO_REGION : "us-east-2";
  const client = new CognitoIdentityProviderClient({ region });
  return {
    async create({ email, poolId }) {
      const password = oneTimePassword();
      try {
        const result = await client.send(new AdminCreateUserCommand(createUserInput(poolId, email, password)));
        await client.send(new AdminSetUserPasswordCommand(setPasswordInput(poolId, email, password)));
        const attributes = result.User?.Attributes ?? [];
        const sub = attributes.find((attribute) => attribute.Name === "sub")?.Value ?? result.User?.Username;
        if (sub === undefined || sub === "") throw new CliError("Could not create the Cognito user.");
        return { sub };
      } catch (error) {
        if (error instanceof CliError) throw error;
        throw new CliError("Could not create the Cognito user.");
      }
    },
  };
}
