# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Stored in `/data`** (`/data/ea-flood.json`): what it learnt about the followed stations
  (name, reference, river, town, coordinates of the station, measures, stage scale), the last
  readings, the last states, the codes of the flood areas around the house and the flood
  warnings in force there. No secret, no account, no token: the service needs none. The **house
  coordinates** are read from Gladys (manifest `location: true`) only to choose the nearest
  stations and flood areas inside the container; they are never sent, stored nor logged.
- **Network**: HTTPS GET requests to one public open-data service only,
  `environment.data.gov.uk` (station and flood area lists, station details, latest readings of
  the followed stations by their reference, flood warnings in force). Nothing listens on the
  network.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the Environment Agency service.
