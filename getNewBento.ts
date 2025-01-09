const apiUrl = "https://opbento.edgexhq.tech/api/bento?n=Benediction&g=benedicti0n&x=benedictionAsh&l=ashesh-bandopadhyay&i=https%3A%2F%2Fi.pinimg.com%2F736x%2F92%2Faf%2F03%2F92af03a5dae07e4ec99e45c56c47c05a.jpg&p=portfolio%20site%20work%20in%20progress...&z=57194";
interface BentoResponse {
  url: string;
}

const fetchBentoUrl = async (apiUrl: string): Promise<string> => {
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data: BentoResponse = (await response.json()) as BentoResponse;
    return data.url;
  } catch (error) {
    console.error("Error fetching Bento URL:", error);
    throw error;
  }
};

// @ts-ignore
fetchBentoUrl(apiUrl);
