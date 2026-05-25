import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req,res){

    if(req.method !== "POST"){
        return res.status(405).json({
            error:"Method not allowed"
        })
    }

    try{

        const { email, licenseKey } = req.body

        if(!email || !licenseKey){

            return res.status(400).json({
                error:"Missing required fields"
            })

        }

        /*
        TODO:
        Validate license in Supabase
        Check download count
        Check country/IP rules
        Log download event
        */

        const { data,error } =
        await supabase.storage
        .from("oppster-downloads")
        .createSignedUrl(
            "founder-member/oppster-founder-member-v1.xlsm",
            600
        )

        if(error){

            return res.status(500).json({
                error:error.message
            })

        }

        return res.status(200).json({

            success:true,
            downloadUrl:data.signedUrl

        })

    }

    catch(err){

        return res.status(500).json({
            error:"Unexpected error"
        })

    }

}
