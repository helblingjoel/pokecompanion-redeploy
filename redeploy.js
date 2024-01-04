import { Octokit } from "@octokit/rest";
import { checkEnvVars } from "./utils.js";
import { getAuthedPb } from "./pocketbase.js";

const folderLocation = "/src/lib/data";
const pokemonFileName = "/pokemonNames.json";
const octokit = new Octokit({ auth: process.env.GITHUB_PAT });

export async function handler(event, context) {
	if (
		!checkEnvVars([
			"POCKETBASE_URL",
			"ADMIN_EMAIL",
			"ADMIN_PASSWORD",
			"GITHUB_PAT",
		])
	) {
		console.error("Missing env variable");
		return;
	}

	const pb = await getAuthedPb();
	if (!pb) {
		return;
	}

	try {
		const result = await updatePokemonGithub(pb);

		if (result) {
			console.log(`Updated: ${JSON.stringify(result)}`);
		} else {
			console.log("No changes");
		}
	} catch (err) {
		console.error("Error", err);
	}
}

const getExistingPokemonFile = async () => {
	const gitPokemonRequest = await fetch(
		`https://raw.githubusercontent.com/helblingjoel/pokecompanion/main${folderLocation}${pokemonFileName}`
	);
	return await gitPokemonRequest.json();
};

const pokemonDbToJson = async (pb) => {
	const pokemon = await pb.collection("pokemon_names").getFullList({
		sort: "national_dex",
	});
	const normalisedDb = pokemon.map((entry) => {
		return {
			id: entry.national_dex,
			generation: entry.generation,
			names: [
				{
					en: entry.en,
				},
				{
					de: entry.de,
				},
				{
					es: entry.es,
				},
				{
					fr: entry.fr,
				},
				{
					it: entry.it,
				},
				{
					"ja-hrkt": entry.ja_hrkt,
				},
				{
					"zh-hans": entry.zh_hans,
				},
			],
		};
	});

	return normalisedDb;
};

function findDifferences(sortedDb, sortedGit) {
	const differences = [];

	const moreEntries =
		sortedDb.length > sortedGit.length ? sortedDb.length : sortedGit.length;
	console.log("Highest Pokedex ID", moreEntries);
	for (let i = 0; i < moreEntries; i++) {
		if (
			JSON.stringify(sortedDb[i]?.names) !==
				JSON.stringify(sortedGit[i]?.names) ||
			sortedDb[i]?.id !== sortedGit[i]?.id
		) {
			differences.push({
				index: i + 1,
				db: JSON.stringify(sortedDb[i]?.names),
				git: JSON.stringify(sortedGit[i]?.names),
			});
		}
	}

	return differences;
}

async function updatePokemonGithub(pb) {
	const [pokemonGithub, pokemonDb] = await Promise.all([
		getExistingPokemonFile(),
		pokemonDbToJson(pb),
	]);

	const sortedDb = pokemonDb.sort((a, b) => {
		return a.id > b.id ? 1 : -1;
	});

	const sortedGit = pokemonGithub.sort((a, b) => {
		return a.id > b.id ? 1 : -1;
	});

	const differences = findDifferences(sortedDb, sortedGit);

	if (differences.length === 0) {
		return false;
	}

	// Convert the merged object to a string and encode it in base64
	const content = Buffer.from(JSON.stringify(sortedDb)).toString("base64");

	const sha = await getFileSha(
		"helblingjoel",
		"pokecompanion",
		"src/lib/data/pokemonNames.json"
	);

	// Commit the changes to the main branch of the GitHub repository
	await octokit.repos.createOrUpdateFileContents({
		owner: "helblingjoel",
		repo: "pokecompanion",
		path: "src/lib/data/pokemonNames.json",
		message: `Auto: ${differences.length} updates syncd\n${differences
			.map((diff) => {
				return `Pokemon ${diff.index}`;
			})
			.join("\n")}`,
		content: content,
		sha,
		branch: "main",
	});

	return differences;
}

async function getFileSha(owner, repo, path) {
	const { data } = await octokit.repos.getContent({
		owner: owner,
		repo: repo,
		path: path,
	});

	return data.sha;
}

// handler();